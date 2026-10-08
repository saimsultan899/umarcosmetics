-- Purchase stock on a spoke company also restocks the linked product on main.

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
  v_wh uuid := (p_payload->>'warehouse_id')::UUID;
  v_qty numeric;
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
    v_company_inv_date, v_gate, v_party, v_wh,
    COALESCE((p_payload->>'subtotal')::NUMERIC, 0),
    COALESCE((p_payload->>'discount_total')::NUMERIC, 0),
    GREATEST(0, COALESCE((p_payload->>'extra_discount')::NUMERIC, 0)),
    v_total, NULLIF(p_payload->>'narration',''), 'posted', auth.uid()
  ) RETURNING id INTO v_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb))
  LOOP
    v_qty := ABS((v_item->>'qty')::NUMERIC);
    INSERT INTO public.purchase_invoice_items (
      purchase_invoice_id, company_id, product_id, product_code, product_name,
      qty, rate, discount, amount, sort_order
    ) VALUES (
      v_id, v_company_id, (v_item->>'product_id')::UUID, v_item->>'product_code', v_item->>'product_name',
      (v_item->>'qty')::NUMERIC, (v_item->>'rate')::NUMERIC, COALESCE((v_item->>'discount')::NUMERIC,0),
      (v_item->>'amount')::NUMERIC, v_idx
    );
    PERFORM private.apply_stock_delta(
      v_company_id, v_wh, (v_item->>'product_id')::UUID,
      v_qty, 'purchase', 'purchase_invoices', v_id, true
    );
    PERFORM private.apply_hub_purchase_stock(
      v_company_id, v_wh, (v_item->>'product_id')::UUID,
      v_qty, 'purchase_invoices', v_id
    );
    v_idx := v_idx + 1;
  END LOOP;
  PERFORM private.post_ledger(v_org_id, v_company_id, v_party, v_date, 0, v_total,
    'Purchase ' || v_no, 'purchase_invoices', v_id, 'PI');
  RETURN v_id;
END;
$function$;
