-- Allow a Paid (cash) sale to take less than the bill total.
-- Unpaid remainder stays on the customer receivable (sale debit minus cash credit).

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
  v_product_id uuid;
  v_stock_wh uuid;
  v_payment public.payment_type := coalesce(
    nullif(p_payload->>'payment_type', '')::public.payment_type,
    'credit'::public.payment_type
  );
  v_paid numeric := greatest(0, coalesce((p_payload->>'amount_paid')::numeric, 0));
  v_walkin boolean := coalesce((p_payload->>'walk_in')::boolean, false);
begin
  if not private.can_write_company(v_company_id) then raise exception 'No write access'; end if;

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
    v_product_id := (v_item->>'product_id')::uuid;

    select coalesce(p.default_warehouse_id, v_header_wh)
      into v_stock_wh
    from public.products p
    where p.id = v_product_id;

    if v_stock_wh is null then
      v_stock_wh := v_header_wh;
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
      -abs(v_qty + v_bonus), 'sale', 'sale_invoices', v_id, false
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
