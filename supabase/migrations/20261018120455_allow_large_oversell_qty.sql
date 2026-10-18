-- Client may post large overselles when sale_stock_policy = confirm.
-- Keep the "block" policy guard; remove only the hard "far above shelf" refuse.

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
  v_request_id uuid := nullif(p_payload->>'client_request_id', '')::uuid;
  v_confirmed boolean := lower(coalesce(p_payload->>'confirm_duplicate', '')) in ('true', 't', '1');
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

  if v_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_request_id::text, 0));
    select id into v_id
    from public.sale_invoices
    where company_id = v_company_id
      and client_request_id = v_request_id;
    if found then
      return v_id;
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_company_id::text || ':' || coalesce(v_party::text, 'none'), 0)
  );

  if not v_confirmed and exists (
    select 1
    from public.sale_invoices
    where company_id = v_company_id
      and party_id = v_party
      and invoice_date = v_date
      and grand_total = v_total
      and status = 'posted'
      and created_at > clock_timestamp() - interval '30 seconds'
  ) then
    raise exception 'This sale was just saved. It was not saved again.';
  end if;

  v_no := public.next_document_no(v_company_id, 'sale_invoice', null);

  insert into public.sale_invoices (
    organization_id, company_id, invoice_no, invoice_date, party_id, warehouse_id,
    salesman_id, route, city, payment_type, subtotal, discount_total, extra_discount,
    grand_total, amount_paid, narration, status, created_by, updated_by, client_request_id
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
    'posted', auth.uid(), auth.uid(),
    v_request_id
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

CREATE OR REPLACE FUNCTION public.update_sale_invoice(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid := (p_payload->>'invoice_id')::uuid;
  v_inv public.sale_invoices%rowtype;
  v_item public.sale_invoice_items%rowtype;
  v_line jsonb;
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
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
  perform set_config('app.replacing_document_lines', '1', true);
  select * into v_inv from public.sale_invoices where id = v_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if not private.can_write_company(v_inv.company_id) then raise exception 'No write access'; end if;
  if v_inv.status <> 'posted' then raise exception 'This invoice is already cancelled'; end if;
  if v_company_id is distinct from v_inv.company_id then raise exception 'Company does not match this invoice'; end if;
  if exists (
    select 1 from public.sale_returns r
    where r.sale_invoice_id = v_inv.id and r.status = 'posted'
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
    if v_stock_wh is null then v_stock_wh := v_inv.warehouse_id; end if;
    perform private.apply_stock_delta(
      v_inv.company_id, v_stock_wh, v_item.product_id,
      abs(v_item.qty) + coalesce(v_item.bonus_qty, 0),
      'adjustment', 'sale_invoices', v_inv.id, true
    );
  end loop;

  delete from public.ledger_entries
  where ref_table = 'sale_invoices' and ref_id = v_inv.id;
  delete from public.sale_invoice_items where sale_invoice_id = v_inv.id;

  select coalesce(c.sale_stock_policy, 'confirm') into v_policy
  from public.companies c where c.id = v_company_id;

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

  update public.sale_invoices set
    invoice_date = v_date,
    party_id = v_party,
    warehouse_id = v_header_wh,
    salesman_id = nullif(p_payload->>'salesman_id','')::uuid,
    route = nullif(p_payload->>'route',''),
    city = nullif(p_payload->>'city',''),
    payment_type = v_payment,
    subtotal = coalesce((p_payload->>'subtotal')::numeric, 0),
    discount_total = coalesce((p_payload->>'discount_total')::numeric, 0),
    extra_discount = greatest(0, coalesce((p_payload->>'extra_discount')::numeric, 0)),
    grand_total = v_total,
    amount_paid = v_paid,
    narration = nullif(p_payload->>'narration',''),
    updated_by = auth.uid(),
    updated_at = now()
  where id = v_inv.id;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    v_qty := coalesce((v_line->>'qty')::numeric, 0);
    v_bonus := greatest(0, coalesce((v_line->>'bonus_qty')::numeric, 0));
    v_need := abs(v_qty) + v_bonus;
    v_product_id := (v_line->>'product_id')::uuid;
    v_name := coalesce(nullif(v_line->>'product_name', ''), nullif(v_line->>'product_code', ''), 'item');

    select coalesce(p.default_warehouse_id, v_header_wh) into v_stock_wh
    from public.products p where p.id = v_product_id;
    if v_stock_wh is null then v_stock_wh := v_header_wh; end if;

    v_on_hand := private.shared_stock_on_hand(v_company_id, v_stock_wh, v_product_id);

    if v_policy = 'block' and v_need > v_on_hand + 0.0005 then
      raise exception 'Only % available for %. This company does not sell past stock.', v_on_hand, v_name;
    end if;

    insert into public.sale_invoice_items (
      sale_invoice_id, company_id, product_id, product_code, product_name,
      qty, bonus_qty, rate, discount, scheme, amount, sort_order
    ) values (
      v_inv.id, v_company_id, v_product_id,
      v_line->>'product_code', v_line->>'product_name',
      v_qty, v_bonus, (v_line->>'rate')::numeric,
      coalesce((v_line->>'discount')::numeric, 0),
      nullif(v_line->>'scheme',''),
      (v_line->>'amount')::numeric, v_idx
    );
    perform private.apply_stock_delta(
      v_company_id, v_stock_wh, v_product_id,
      -abs(v_qty + v_bonus), 'sale', 'sale_invoices', v_inv.id, v_policy <> 'block'
    );
    v_idx := v_idx + 1;
  end loop;

  perform private.post_ledger(v_org_id, v_company_id, v_party, v_date, v_total, 0,
    'Sale ' || v_inv.invoice_no, 'sale_invoices', v_inv.id, 'SI');
  if v_paid > 0 then
    perform private.post_ledger(v_org_id, v_company_id, v_party, v_date, 0, v_paid,
      'Cash on sale ' || v_inv.invoice_no, 'sale_invoices', v_inv.id, 'CR');
  end if;

  return v_inv.id;
end;
$function$;
