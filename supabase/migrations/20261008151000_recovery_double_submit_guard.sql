-- One click must not create several recoveries.
-- A repeated save of the same request returns the recovery already stored.
-- A second click for the same shop, date, and amount is refused for 30 seconds
-- unless the user confirmed it is a separate collection.

ALTER TABLE public.recoveries
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS recoveries_client_request_id_uidx
  ON public.recoveries (company_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

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
  v_balance NUMERIC;
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

  v_balance := public.get_party_balance(v_company_id, v_party, v_date);
  IF v_balance <= 0.005 THEN
    RAISE EXCEPTION 'This customer has no amount due. The recovery was not saved.';
  END IF;
  IF v_amount > v_balance + 0.005 THEN
    RAISE EXCEPTION 'Recovery is more than the amount due (%). The recovery was not saved.', v_balance;
  END IF;

  v_voucher_id := public.create_cash_receipt(jsonb_build_object(
    'organization_id', v_org_id,
    'company_id', v_company_id,
    'voucher_date', v_date,
    'narration', COALESCE(NULLIF(p_payload->>'remarks',''), 'Recovery collection'),
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
