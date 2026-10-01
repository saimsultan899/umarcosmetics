-- Each company chooses whether a short shelf blocks the sale or only warns.
-- A quantity far above the shelf is refused for both choices.

alter table public.companies
  add column if not exists sale_stock_policy text not null default 'confirm';

alter table public.companies
  drop constraint if exists companies_sale_stock_policy_check;

alter table public.companies
  add constraint companies_sale_stock_policy_check
  check (sale_stock_policy in ('block', 'confirm'));

CREATE OR REPLACE FUNCTION public.create_sale_invoice(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_id uuid;
  v_no text;
  v_item jsonb;
  v_idx int := 0;
  v_total numeric := coalesce((p_payload->>'grand_total')::numeric, 0);
  v_date date := coalesce((p_payload->>'invoice_date')::date, current_date);
  v_party uuid := nullif(p_payload->>'party_id', '')::uuid;
  v_header_wh uuid := (p_payload->>'warehouse_id')::uuid;
  v_qty numeric;
  v_bonus numeric;
  v_need numeric;
  v_on_hand numeric;
  v_product_id uuid;
  v_stock_wh uuid;
  v_name text;
  v_policy text := 'confirm';
  v_payment public.payment_type := coalesce(
    nullif(p_payload->>'payment_type', '')::public.payment_type,
    'credit'::public.payment_type
  );
  v_paid numeric := greatest(0, coalesce((p_payload->>'amount_paid')::numeric, 0));
  v_walkin boolean := coalesce((p_payload->>'walk_in')::boolean, false);
begin
  if not private.can_write_company(v_company_id) then raise exception 'No write access'; end if;

  select coalesce(c.sale_stock_policy, 'confirm')
    into v_policy
  from public.companies c
  where c.id = v_company_id;

  v_paid := least(v_paid, v_total);

  if v_payment = 'credit' then
    v_paid := 0;
  elsif v_payment in ('cash', 'partial') then
    if v_paid >= v_total - 0.005 then
      v_payment := 'cash';
      v_paid := v_total;
    elsif v_paid > 0.005 then
      v_payment := 'partial';
    else
      raise exception 'Enter the amount received, or save the bill as Credit';
    end if;
  end if;

  if v_walkin then
    if v_payment <> 'cash' or v_paid < v_total - 0.005 then
      raise exception 'Walk-in customer must pay the full bill';
    end if;
  end if;

  if v_party is null then
    if v_walkin and v_payment = 'cash' then
      v_party := private.ensure_walkin_party(v_org_id, v_company_id);
    else
      raise exception 'Select a customer';
    end if;
  end if;

  v_no := public.next_document_no(v_company_id, 'sale_invoice', null);

  insert into public.sale_invoices (
    organization_id, company_id, invoice_no, invoice_date, party_id, warehouse_id,
    salesman_id, route, city, payment_type, subtotal, discount_total, extra_discount,
    grand_total, amount_paid, narration, status, created_by, updated_by
  ) values (
    v_org_id, v_company_id, v_no, v_date, v_party,
    v_header_wh,
    nullif(p_payload->>'salesman_id','')::uuid,
    nullif(p_payload->>'route',''),
    nullif(p_payload->>'city',''),
    v_payment,
    coalesce((p_payload->>'subtotal')::numeric, 0),
    coalesce((p_payload->>'discount_total')::numeric, 0),
    greatest(0, coalesce((p_payload->>'extra_discount')::numeric, 0)),
    v_total,
    v_paid,
    nullif(p_payload->>'narration',''),
    'posted', auth.uid(), auth.uid()
  ) returning id into v_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    v_qty := coalesce((v_item->>'qty')::numeric, 0);
    v_bonus := greatest(0, coalesce((v_item->>'bonus_qty')::numeric, 0));
    v_need := abs(v_qty) + v_bonus;
    v_product_id := (v_item->>'product_id')::uuid;
    v_name := coalesce(nullif(v_item->>'product_name', ''), nullif(v_item->>'product_code', ''), 'item');

    select coalesce(p.default_warehouse_id, v_header_wh)
      into v_stock_wh
    from public.products p
    where p.id = v_product_id;

    if v_stock_wh is null then
      v_stock_wh := v_header_wh;
    end if;

    select coalesce(sb.qty, 0)
      into v_on_hand
    from public.stock_balances sb
    where sb.company_id = v_company_id
      and sb.warehouse_id = v_stock_wh
      and sb.product_id = v_product_id;
    v_on_hand := coalesce(v_on_hand, 0);

    if v_need > v_on_hand + 0.0005
       and v_need > greatest(v_on_hand, 0) * 10
       and v_need > greatest(v_on_hand, 0) + 200 then
      raise exception 'Quantity for % is far above stock on hand (%). Check the number.', v_name, v_on_hand;
    end if;

    if v_policy = 'block' and v_need > v_on_hand + 0.0005 then
      raise exception 'Only % available for %. This company does not sell past stock.', v_on_hand, v_name;
    end if;

    insert into public.sale_invoice_items (
      sale_invoice_id, company_id, product_id, product_code, product_name,
      qty, bonus_qty, rate, discount, scheme, amount, sort_order
    ) values (
      v_id, v_company_id,
      v_product_id,
      v_item->>'product_code',
      v_item->>'product_name',
      v_qty,
      v_bonus,
      (v_item->>'rate')::numeric,
      coalesce((v_item->>'discount')::numeric, 0),
      nullif(v_item->>'scheme',''),
      (v_item->>'amount')::numeric,
      v_idx
    );

    perform private.apply_stock_delta(
      v_company_id, v_stock_wh, v_product_id,
      -abs(v_qty + v_bonus), 'sale', 'sale_invoices', v_id, v_policy <> 'block'
    );
    v_idx := v_idx + 1;
  end loop;

  perform private.post_ledger(v_org_id, v_company_id, v_party, v_date, v_total, 0,
    'Sale ' || v_no, 'sale_invoices', v_id, 'SI');

  if v_paid > 0 then
    perform private.post_ledger(v_org_id, v_company_id, v_party, v_date, 0, v_paid,
      'Cash on sale ' || v_no, 'sale_invoices', v_id, 'CR');
  end if;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_sale_invoice(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inv public.sale_invoices%rowtype;
  v_item public.sale_invoice_items%rowtype;
  v_stock_wh uuid;
begin
  select * into v_inv from public.sale_invoices where id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if not private.can_write_company(v_inv.company_id) then
    raise exception 'No write access';
  end if;
  if v_inv.status <> 'posted' then
    raise exception 'This invoice is already cancelled';
  end if;
  if exists (
    select 1
    from public.sale_returns r
    where r.sale_invoice_id = v_inv.id
      and r.status = 'posted'
  ) then
    raise exception 'A sale return is already posted against this invoice';
  end if;

  for v_item in
    select * from public.sale_invoice_items where sale_invoice_id = v_inv.id
  loop
    select coalesce(p.default_warehouse_id, v_inv.warehouse_id)
      into v_stock_wh
    from public.products p
    where p.id = v_item.product_id;
    if v_stock_wh is null then
      v_stock_wh := v_inv.warehouse_id;
    end if;
    perform private.apply_stock_delta(
      v_inv.company_id,
      v_stock_wh,
      v_item.product_id,
      abs(v_item.qty) + coalesce(v_item.bonus_qty, 0),
      'adjustment',
      'sale_invoices',
      v_inv.id,
      true
    );
  end loop;

  perform private.post_ledger(
    v_inv.organization_id, v_inv.company_id, v_inv.party_id, v_inv.invoice_date,
    0, v_inv.grand_total,
    'Cancel sale ' || v_inv.invoice_no,
    'sale_invoices', v_inv.id, 'SI'
  );

  if coalesce(v_inv.amount_paid, 0) > 0 then
    perform private.post_ledger(
      v_inv.organization_id, v_inv.company_id, v_inv.party_id, v_inv.invoice_date,
      v_inv.amount_paid, 0,
      'Cancel cash on sale ' || v_inv.invoice_no,
      'sale_invoices', v_inv.id, 'CR'
    );
  end if;

  update public.sale_invoices
  set status = 'cancelled',
      updated_by = auth.uid(),
      updated_at = now()
  where id = v_inv.id;
end;
$function$;
