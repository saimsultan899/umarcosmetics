-- Gate pass link + company invoice date on purchase invoices.
-- supplier_bill_no remains the company invoice number.

ALTER TABLE public.purchase_invoices
  ADD COLUMN IF NOT EXISTS gate_pass_id uuid REFERENCES public.gate_passes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_invoice_date date;

CREATE INDEX IF NOT EXISTS purchase_invoices_gate_pass_id_idx
  ON public.purchase_invoices (gate_pass_id)
  WHERE gate_pass_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_purchase_invoice(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID := (p_payload->>'company_id')::UUID;
  v_org_id UUID := (p_payload->>'organization_id')::UUID;
  v_id UUID; v_no TEXT; v_item JSONB; v_idx INT := 0;
  v_total NUMERIC := COALESCE((p_payload->>'grand_total')::NUMERIC, 0);
  v_date DATE := COALESCE((p_payload->>'invoice_date')::DATE, CURRENT_DATE);
  v_party UUID := (p_payload->>'party_id')::UUID;
  v_gate uuid := NULLIF(p_payload->>'gate_pass_id','')::UUID;
  v_company_inv_date date := NULLIF(p_payload->>'company_invoice_date','')::DATE;
BEGIN
  IF NOT private.can_write_company(v_company_id) THEN RAISE EXCEPTION 'No write access'; END IF;

  IF v_gate IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.gate_passes g
    WHERE g.id = v_gate AND g.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Gate pass not found for this company';
  END IF;

  v_no := public.next_document_no(v_company_id, 'purchase_invoice', NULL);
  INSERT INTO public.purchase_invoices (
    organization_id, company_id, invoice_no, supplier_bill_no, invoice_date,
    company_invoice_date, gate_pass_id, party_id, warehouse_id,
    subtotal, discount_total, extra_discount, grand_total, narration, status, created_by
  ) VALUES (
    v_org_id, v_company_id, v_no, NULLIF(p_payload->>'supplier_bill_no',''), v_date,
    v_company_inv_date, v_gate, v_party,
    (p_payload->>'warehouse_id')::UUID,
    COALESCE((p_payload->>'subtotal')::NUMERIC, 0),
    COALESCE((p_payload->>'discount_total')::NUMERIC, 0),
    GREATEST(0, COALESCE((p_payload->>'extra_discount')::NUMERIC, 0)),
    v_total, NULLIF(p_payload->>'narration',''), 'posted', auth.uid()
  ) RETURNING id INTO v_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb))
  LOOP
    INSERT INTO public.purchase_invoice_items (
      purchase_invoice_id, company_id, product_id, product_code, product_name,
      qty, rate, discount, amount, sort_order
    ) VALUES (
      v_id, v_company_id, (v_item->>'product_id')::UUID, v_item->>'product_code', v_item->>'product_name',
      (v_item->>'qty')::NUMERIC, (v_item->>'rate')::NUMERIC, COALESCE((v_item->>'discount')::NUMERIC,0),
      (v_item->>'amount')::NUMERIC, v_idx
    );
    PERFORM private.apply_stock_delta(
      v_company_id, (p_payload->>'warehouse_id')::UUID, (v_item->>'product_id')::UUID,
      ABS((v_item->>'qty')::NUMERIC), 'purchase', 'purchase_invoices', v_id, true
    );
    v_idx := v_idx + 1;
  END LOOP;
  PERFORM private.post_ledger(v_org_id, v_company_id, v_party, v_date, 0, v_total,
    'Purchase ' || v_no, 'purchase_invoices', v_id, 'PI');
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_purchase_invoice(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := (p_payload->>'invoice_id')::uuid;
  v_inv public.purchase_invoices%rowtype;
  v_item public.purchase_invoice_items%rowtype;
  v_line jsonb;
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_party uuid := (p_payload->>'party_id')::uuid;
  v_wh uuid := (p_payload->>'warehouse_id')::uuid;
  v_total numeric := coalesce((p_payload->>'grand_total')::numeric, 0);
  v_date date := coalesce((p_payload->>'invoice_date')::date, current_date);
  v_gate uuid := NULLIF(p_payload->>'gate_pass_id','')::UUID;
  v_company_inv_date date := NULLIF(p_payload->>'company_invoice_date','')::DATE;
  v_idx int := 0;
begin
  select * into v_inv from public.purchase_invoices where id = v_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if not private.can_write_company(v_inv.company_id) then raise exception 'No write access'; end if;
  if v_inv.status <> 'posted' then raise exception 'This invoice is already cancelled'; end if;
  if v_company_id is distinct from v_inv.company_id then raise exception 'Company does not match this invoice'; end if;
  if exists (
    select 1 from public.purchase_returns r
    where r.purchase_invoice_id = v_inv.id and r.status = 'posted'
  ) then
    raise exception 'A purchase return is already posted against this invoice';
  end if;

  IF v_gate IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.gate_passes g
    WHERE g.id = v_gate AND g.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Gate pass not found for this company';
  END IF;

  for v_item in
    select * from public.purchase_invoice_items where purchase_invoice_id = v_inv.id
  loop
    perform private.apply_stock_delta(
      v_inv.company_id, v_inv.warehouse_id, v_item.product_id,
      -abs(v_item.qty), 'adjustment', 'purchase_invoices', v_inv.id, true
    );
  end loop;

  delete from public.ledger_entries
  where ref_table = 'purchase_invoices' and ref_id = v_inv.id;
  delete from public.purchase_invoice_items where purchase_invoice_id = v_inv.id;

  update public.purchase_invoices set
    supplier_bill_no = nullif(p_payload->>'supplier_bill_no',''),
    invoice_date = v_date,
    company_invoice_date = v_company_inv_date,
    gate_pass_id = v_gate,
    party_id = v_party,
    warehouse_id = v_wh,
    subtotal = coalesce((p_payload->>'subtotal')::numeric, 0),
    discount_total = coalesce((p_payload->>'discount_total')::numeric, 0),
    extra_discount = greatest(0, coalesce((p_payload->>'extra_discount')::numeric, 0)),
    grand_total = v_total,
    narration = nullif(p_payload->>'narration',''),
    updated_at = now()
  where id = v_inv.id;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    insert into public.purchase_invoice_items (
      purchase_invoice_id, company_id, product_id, product_code, product_name,
      qty, rate, discount, amount, sort_order
    ) values (
      v_inv.id, v_company_id, (v_line->>'product_id')::uuid,
      v_line->>'product_code', v_line->>'product_name',
      (v_line->>'qty')::numeric, (v_line->>'rate')::numeric,
      coalesce((v_line->>'discount')::numeric, 0),
      (v_line->>'amount')::numeric, v_idx
    );
    perform private.apply_stock_delta(
      v_company_id, v_wh, (v_line->>'product_id')::uuid,
      abs((v_line->>'qty')::numeric), 'purchase', 'purchase_invoices', v_inv.id, true
    );
    v_idx := v_idx + 1;
  end loop;

  perform private.post_ledger(v_org_id, v_company_id, v_party, v_date, 0, v_total,
    'Purchase ' || v_inv.invoice_no, 'purchase_invoices', v_inv.id, 'PI');
  return v_inv.id;
end;
$function$;

REVOKE ALL ON FUNCTION public.create_purchase_invoice(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_purchase_invoice(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_purchase_invoice(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_purchase_invoice(jsonb) TO authenticated, service_role;
