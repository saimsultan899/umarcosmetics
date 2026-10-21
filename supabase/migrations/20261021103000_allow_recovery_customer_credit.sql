-- Allow recovery / cash collection above the amount due. Extra received becomes
-- customer credit (negative receivable), same pattern as sale returns.

CREATE OR REPLACE FUNCTION public.record_recovery(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID := (p_payload->>'company_id')::UUID;
  v_org_id UUID := (p_payload->>'organization_id')::UUID;
  v_party UUID := (p_payload->>'party_id')::UUID;
  v_amount NUMERIC := COALESCE((p_payload->>'amount')::NUMERIC, 0);
  v_date DATE := COALESCE((p_payload->>'recovery_date')::DATE, CURRENT_DATE);
  v_request_id UUID := NULLIF(p_payload->>'client_request_id', '')::UUID;
  v_confirmed BOOLEAN := lower(COALESCE(p_payload->>'confirm_duplicate', '')) IN ('true', 't', '1');
  v_voucher_id UUID;
  v_recovery_id UUID;
  v_party_row public.parties%ROWTYPE;
BEGIN
  IF NOT private.can_write_company(v_company_id) THEN RAISE EXCEPTION 'No write access'; END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Recovery amount must be greater than zero'; END IF;

  IF v_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_request_id::text, 0));
    SELECT id INTO v_recovery_id
    FROM public.recoveries
    WHERE company_id = v_company_id
      AND client_request_id = v_request_id;
    IF FOUND THEN
      RETURN v_recovery_id;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':' || v_party::text, 0));

  SELECT * INTO v_party_row FROM public.parties WHERE id = v_party AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Party not found'; END IF;

  IF NOT v_confirmed AND EXISTS (
    SELECT 1
    FROM public.recoveries
    WHERE company_id = v_company_id
      AND party_id = v_party
      AND recovery_date = v_date
      AND amount = v_amount
      AND created_at > clock_timestamp() - interval '30 seconds'
  ) THEN
    RAISE EXCEPTION 'This recovery was just saved. It was not saved again.';
  END IF;

  v_voucher_id := public.create_cash_receipt(jsonb_build_object(
    'organization_id', v_org_id,
    'company_id', v_company_id,
    'voucher_date', v_date,
    'narration', COALESCE(NULLIF(p_payload->>'remarks',''), 'Recovery collection'),
    'skip_recovery_rows', true,
    'lines', jsonb_build_array(jsonb_build_object(
      'party_id', v_party,
      'amount', v_amount,
      'narration', COALESCE(NULLIF(p_payload->>'remarks',''), 'Recovery')
    ))
  ));

  INSERT INTO public.recoveries (
    organization_id, company_id, party_id, recovery_date, amount, remarks,
    voucher_id, salesman_id, route, city, created_by, client_request_id
  ) VALUES (
    v_org_id, v_company_id, v_party, v_date, v_amount,
    NULLIF(p_payload->>'remarks',''),
    v_voucher_id,
    NULLIF(p_payload->>'salesman_id','')::UUID,
    COALESCE(NULLIF(p_payload->>'route',''), v_party_row.route),
    COALESCE(NULLIF(p_payload->>'city',''), v_party_row.city),
    auth.uid(),
    v_request_id
  ) RETURNING id INTO v_recovery_id;

  RETURN v_recovery_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_recovery(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := (p_payload->>'recovery_id')::uuid;
  v_rec public.recoveries%rowtype;
  v_party_row public.parties%rowtype;
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_party uuid := (p_payload->>'party_id')::uuid;
  v_amount numeric := coalesce((p_payload->>'amount')::numeric, 0);
  v_date date := coalesce((p_payload->>'recovery_date')::date, current_date);
  v_note text;
BEGIN
  PERFORM set_config('app.replacing_document_lines', '1', true);
  SELECT * INTO v_rec FROM public.recoveries WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recovery not found'; END IF;
  IF NOT private.can_write_company(v_rec.company_id) THEN RAISE EXCEPTION 'No write access'; END IF;
  IF v_company_id IS DISTINCT FROM v_rec.company_id THEN RAISE EXCEPTION 'Company does not match this recovery'; END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Recovery amount must be greater than zero'; END IF;

  SELECT * INTO v_party_row FROM public.parties WHERE id = v_party AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Party not found'; END IF;

  IF v_rec.voucher_id IS NOT NULL THEN
    DELETE FROM public.ledger_entries
    WHERE ref_table = 'vouchers' AND ref_id = v_rec.voucher_id;
    DELETE FROM public.voucher_lines WHERE voucher_id = v_rec.voucher_id;
  ELSE
    DELETE FROM public.ledger_entries
    WHERE ref_table = 'recoveries' AND ref_id = v_rec.id;
  END IF;

  v_note := coalesce(nullif(p_payload->>'remarks',''), 'Recovery');

  IF v_rec.voucher_id IS NOT NULL THEN
    UPDATE public.vouchers SET
      voucher_date = v_date,
      total_amount = v_amount,
      narration = v_note,
      updated_at = now()
    WHERE id = v_rec.voucher_id;
    INSERT INTO public.voucher_lines (voucher_id, company_id, party_id, amount, narration, sort_order)
    VALUES (v_rec.voucher_id, v_company_id, v_party, v_amount, v_note, 0);
    PERFORM private.post_ledger(
      v_org_id, v_company_id, v_party, v_date,
      0, v_amount, v_note, 'vouchers', v_rec.voucher_id, 'CR'
    );
  ELSE
    PERFORM private.post_ledger(
      v_org_id, v_company_id, v_party, v_date,
      0, v_amount, v_note, 'recoveries', v_rec.id, 'CR'
    );
  END IF;

  UPDATE public.recoveries SET
    party_id = v_party,
    recovery_date = v_date,
    amount = v_amount,
    remarks = nullif(p_payload->>'remarks',''),
    salesman_id = nullif(p_payload->>'salesman_id','')::uuid,
    route = coalesce(nullif(p_payload->>'route',''), v_party_row.route),
    city = coalesce(nullif(p_payload->>'city',''), v_party_row.city)
  WHERE id = v_rec.id;

  RETURN v_rec.id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.record_recovery(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_recovery(jsonb) TO authenticated, service_role;
