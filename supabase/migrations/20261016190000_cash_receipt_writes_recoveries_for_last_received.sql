-- Cash receipt form posted vouchers without recoveries rows, so Customer
-- Receivables "Last received" stayed blank (Imran Traders / Umar Group).
-- Recovery form already inserts recoveries after create_cash_receipt — pass
-- skip_recovery_rows to avoid duplicates. Also fix cancel when one CR voucher
-- has many recovery lines.

CREATE OR REPLACE FUNCTION public.create_cash_receipt(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID := (p_payload->>'company_id')::UUID;
  v_org_id UUID := (p_payload->>'organization_id')::UUID;
  v_id UUID; v_no TEXT; v_line JSONB; v_idx INT := 0;
  v_total NUMERIC := 0;
  v_date DATE := COALESCE((p_payload->>'voucher_date')::DATE, CURRENT_DATE);
  v_skip_recovery BOOLEAN := lower(COALESCE(p_payload->>'skip_recovery_rows', '')) IN ('true', 't', '1');
  v_party UUID;
  v_amount NUMERIC;
  v_party_row public.parties%ROWTYPE;
BEGIN
  IF NOT private.can_write_company(v_company_id) THEN RAISE EXCEPTION 'No write access'; END IF;
  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'lines', '[]'::jsonb))
  LOOP v_total := v_total + COALESCE((v_line->>'amount')::NUMERIC, 0); END LOOP;
  IF v_total <= 0 THEN RAISE EXCEPTION 'Receipt total must be greater than zero'; END IF;

  v_no := public.next_document_no(v_company_id, 'cash_receipt', NULL);
  INSERT INTO public.vouchers (
    organization_id, company_id, voucher_type, voucher_no, voucher_date,
    total_amount, narration, status, created_by
  ) VALUES (
    v_org_id, v_company_id, 'CR', v_no, v_date, v_total,
    NULLIF(p_payload->>'narration',''), 'posted', auth.uid()
  ) RETURNING id INTO v_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'lines', '[]'::jsonb))
  LOOP
    v_party := (v_line->>'party_id')::UUID;
    v_amount := COALESCE((v_line->>'amount')::NUMERIC, 0);
    INSERT INTO public.voucher_lines (voucher_id, company_id, party_id, amount, narration, sort_order)
    VALUES (v_id, v_company_id, v_party, v_amount,
      NULLIF(v_line->>'narration',''), v_idx);
    PERFORM private.post_ledger(v_org_id, v_company_id, v_party, v_date,
      0, v_amount,
      COALESCE(NULLIF(v_line->>'narration',''), 'Cash receipt ' || v_no),
      'vouchers', v_id, 'CR');

    IF NOT v_skip_recovery AND v_party IS NOT NULL AND v_amount > 0 THEN
      SELECT * INTO v_party_row FROM public.parties WHERE id = v_party AND company_id = v_company_id;
      IF FOUND THEN
        INSERT INTO public.recoveries (
          organization_id, company_id, party_id, recovery_date, amount, remarks,
          voucher_id, route, city, created_by
        ) VALUES (
          v_org_id, v_company_id, v_party, v_date, v_amount,
          NULLIF(v_line->>'narration',''),
          v_id,
          v_party_row.route,
          v_party_row.city,
          auth.uid()
        );
      END IF;
    END IF;

    v_idx := v_idx + 1;
  END LOOP;
  RETURN v_id;
END;
$function$;

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

-- Cancel one shop line on a multi-shop cash receipt without wiping the others.
CREATE OR REPLACE FUNCTION public.cancel_recovery(p_recovery_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rec public.recoveries%rowtype;
  v_voucher public.vouchers%rowtype;
  v_other INT := 0;
BEGIN
  SELECT * INTO v_rec FROM public.recoveries WHERE id = p_recovery_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recovery not found';
  END IF;

  IF NOT private.can_write_company(v_rec.company_id) THEN
    RAISE EXCEPTION 'No write access';
  END IF;

  IF coalesce(v_rec.amount, 0) <= 0 THEN
    RAISE EXCEPTION 'This recovery has no amount to cancel';
  END IF;

  IF v_rec.voucher_id IS NOT NULL THEN
    SELECT * INTO v_voucher FROM public.vouchers WHERE id = v_rec.voucher_id;
    IF FOUND THEN
      IF v_voucher.status = 'cancelled' THEN
        RAISE EXCEPTION 'This recovery is already cancelled';
      END IF;

      PERFORM private.post_ledger(
        v_rec.organization_id,
        v_rec.company_id,
        v_rec.party_id,
        v_rec.recovery_date,
        v_rec.amount,
        0,
        'Cancel recovery ' || coalesce(v_voucher.voucher_no, 'CR'),
        'vouchers',
        v_voucher.id,
        'CR'
      );

      SELECT count(*) INTO v_other
      FROM public.recoveries
      WHERE voucher_id = v_rec.voucher_id
        AND id <> v_rec.id;

      IF v_other = 0 THEN
        UPDATE public.vouchers
        SET status = 'cancelled', updated_at = now()
        WHERE id = v_voucher.id;
      ELSE
        UPDATE public.vouchers
        SET total_amount = greatest(0, coalesce(total_amount, 0) - v_rec.amount),
            updated_at = now()
        WHERE id = v_voucher.id;
        PERFORM set_config('app.replacing_document_lines', '1', true);
        DELETE FROM public.voucher_lines
        WHERE id = (
          SELECT vl.id
          FROM public.voucher_lines vl
          WHERE vl.voucher_id = v_voucher.id
            AND vl.party_id = v_rec.party_id
            AND vl.amount = v_rec.amount
          ORDER BY vl.sort_order
          LIMIT 1
        );
      END IF;
    END IF;
  ELSE
    PERFORM private.post_ledger(
      v_rec.organization_id,
      v_rec.company_id,
      v_rec.party_id,
      v_rec.recovery_date,
      v_rec.amount,
      0,
      'Cancel recovery',
      'recoveries',
      v_rec.id,
      'CR'
    );
  END IF;

  PERFORM set_config('app.cancelling_recovery', '1', true);
  DELETE FROM public.recoveries WHERE id = v_rec.id;
END;
$function$;

-- Backfill recoveries for posted cash receipts that never wrote recovery rows.
INSERT INTO public.recoveries (
  organization_id, company_id, party_id, recovery_date, amount, remarks,
  voucher_id, route, city, created_by, created_at
)
SELECT
  v.organization_id,
  v.company_id,
  vl.party_id,
  v.voucher_date,
  vl.amount,
  vl.narration,
  v.id,
  p.route,
  p.city,
  v.created_by,
  v.created_at
FROM public.vouchers v
JOIN public.voucher_lines vl ON vl.voucher_id = v.id
JOIN public.parties p ON p.id = vl.party_id
WHERE v.voucher_type = 'CR'
  AND v.status = 'posted'
  AND vl.party_id IS NOT NULL
  AND coalesce(vl.amount, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.recoveries r
    WHERE r.voucher_id = v.id
      AND r.party_id = vl.party_id
      AND r.amount = vl.amount
  );
