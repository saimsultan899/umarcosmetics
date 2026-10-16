-- Allow editing a posted gate pass (header + lines) when no purchase is linked.

CREATE OR REPLACE FUNCTION public.update_gate_pass(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := NULLIF(p_payload->>'gate_pass_id','')::uuid;
  v_company_id uuid;
  v_status text;
  v_item jsonb;
  v_idx int := 0;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Gate pass id is required';
  END IF;

  SELECT company_id, status
    INTO v_company_id, v_status
  FROM public.gate_passes
  WHERE id = v_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found';
  END IF;

  IF NOT private.can_write_company(v_company_id) THEN
    RAISE EXCEPTION 'No write access';
  END IF;

  IF v_status <> 'posted' THEN
    RAISE EXCEPTION 'Only posted gate passes can be updated';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.purchase_invoices p
    WHERE p.gate_pass_id = v_id
      AND p.status = 'posted'
  ) THEN
    RAISE EXCEPTION 'A purchase invoice is already posted against this gate pass';
  END IF;

  IF jsonb_array_length(coalesce(p_payload->'items', '[]'::jsonb)) < 1 THEN
    RAISE EXCEPTION 'Add at least one product line';
  END IF;

  UPDATE public.gate_passes SET
    pass_date = coalesce((p_payload->>'pass_date')::date, pass_date),
    party_id = nullif(p_payload->>'party_id','')::uuid,
    warehouse_id = nullif(p_payload->>'warehouse_id','')::uuid,
    manufacturer = nullif(p_payload->>'manufacturer',''),
    vehicle_no = nullif(p_payload->>'vehicle_no',''),
    transporter = nullif(p_payload->>'transporter',''),
    po_no = nullif(p_payload->>'po_no',''),
    bilty_no = nullif(p_payload->>'bilty_no',''),
    remarks = nullif(p_payload->>'remarks',''),
    updated_at = now()
  WHERE id = v_id;

  DELETE FROM public.gate_pass_items WHERE gate_pass_id = v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  LOOP
    INSERT INTO public.gate_pass_items (
      gate_pass_id, company_id, product_id, product_code, product_name, qty, sort_order
    ) VALUES (
      v_id, v_company_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_code',
      v_item->>'product_name',
      greatest(0, coalesce((v_item->>'qty')::numeric, 0)),
      v_idx
    );
    v_idx := v_idx + 1;
  END LOOP;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_gate_pass(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_gate_pass(jsonb) TO authenticated, service_role;
