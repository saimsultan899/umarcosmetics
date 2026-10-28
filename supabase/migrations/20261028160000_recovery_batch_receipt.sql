-- One Record recovery save shares one cash receipt. Each shop still gets its
-- own recovery row and its own ledger credit. Older receipts are not renumbered.
-- Editing or cancelling one shop on a shared receipt leaves the other shops.

CREATE OR REPLACE FUNCTION public.record_recovery_batch(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_date date := coalesce((p_payload->>'recovery_date')::date, current_date);
  v_salesman uuid := nullif(p_payload->>'salesman_id', '')::uuid;
  v_line jsonb;
  v_party uuid;
  v_amount numeric;
  v_request uuid;
  v_confirmed boolean;
  v_party_row public.parties%rowtype;
  v_existing uuid;
  v_voucher_id uuid;
  v_lines jsonb := '[]'::jsonb;
  v_count int := 0;
  v_seen int := 0;
BEGIN
  IF NOT private.can_write_company(v_company_id) THEN
    RAISE EXCEPTION 'No write access';
  END IF;
  IF jsonb_typeof(p_payload->'lines') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_payload->'lines') < 1 THEN
    RAISE EXCEPTION 'Add at least one recovery line';
  END IF;

  -- A retry of the same save returns the receipt already created.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_payload->'lines')
  LOOP
    v_request := nullif(v_line->>'client_request_id', '')::uuid;
    IF v_request IS NULL THEN
      CONTINUE;
    END IF;
    SELECT voucher_id INTO v_existing
    FROM public.recoveries
    WHERE company_id = v_company_id
      AND client_request_id = v_request;
    IF FOUND THEN
      v_seen := v_seen + 1;
      IF v_voucher_id IS NULL THEN
        v_voucher_id := v_existing;
      ELSIF v_voucher_id IS DISTINCT FROM v_existing THEN
        RAISE EXCEPTION 'This recovery was already saved on another receipt';
      END IF;
    END IF;
  END LOOP;
  IF v_seen > 0 THEN
    IF v_seen <> jsonb_array_length(p_payload->'lines') OR v_voucher_id IS NULL THEN
      RAISE EXCEPTION 'This recovery was already saved. It was not saved again.';
    END IF;
    RETURN v_voucher_id;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_payload->'lines')
  LOOP
    v_party := (v_line->>'party_id')::uuid;
    v_amount := coalesce((v_line->>'amount')::numeric, 0);
    v_confirmed := lower(coalesce(v_line->>'confirm_duplicate', '')) IN ('true', 't', '1');
    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'Recovery amount must be greater than zero';
    END IF;
    SELECT * INTO v_party_row
    FROM public.parties
    WHERE id = v_party AND company_id = v_company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Party not found';
    END IF;
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
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'party_id', v_party,
      'amount', v_amount,
      'narration', coalesce(nullif(v_line->>'remarks', ''), 'Recovery')
    ));
    v_count := v_count + 1;
  END LOOP;

  v_voucher_id := public.create_cash_receipt(jsonb_build_object(
    'organization_id', v_org_id,
    'company_id', v_company_id,
    'voucher_date', v_date,
    'narration', coalesce(nullif(p_payload->>'narration', ''), 'Recovery collection'),
    'skip_recovery_rows', true,
    'lines', v_lines
  ));

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_payload->'lines')
  LOOP
    v_party := (v_line->>'party_id')::uuid;
    v_amount := coalesce((v_line->>'amount')::numeric, 0);
    v_request := nullif(v_line->>'client_request_id', '')::uuid;
    SELECT * INTO v_party_row
    FROM public.parties
    WHERE id = v_party AND company_id = v_company_id;
    INSERT INTO public.recoveries (
      organization_id, company_id, party_id, recovery_date, amount, remarks,
      voucher_id, salesman_id, route, city, created_by, client_request_id
    ) VALUES (
      v_org_id, v_company_id, v_party, v_date, v_amount,
      nullif(v_line->>'remarks', ''),
      v_voucher_id,
      v_salesman,
      coalesce(nullif(v_line->>'route', ''), v_party_row.route),
      coalesce(nullif(v_line->>'city', ''), v_party_row.city),
      auth.uid(),
      v_request
    );
  END LOOP;

  RETURN v_voucher_id;
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
  v_others int := 0;
BEGIN
  PERFORM set_config('app.replacing_document_lines', '1', true);
  SELECT * INTO v_rec FROM public.recoveries WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recovery not found'; END IF;
  IF NOT private.can_write_company(v_rec.company_id) THEN RAISE EXCEPTION 'No write access'; END IF;
  IF v_company_id IS DISTINCT FROM v_rec.company_id THEN RAISE EXCEPTION 'Company does not match this recovery'; END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Recovery amount must be greater than zero'; END IF;

  SELECT * INTO v_party_row FROM public.parties WHERE id = v_party AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Party not found'; END IF;

  v_note := coalesce(nullif(p_payload->>'remarks', ''), 'Recovery');

  IF v_rec.voucher_id IS NOT NULL THEN
    SELECT count(*) INTO v_others
    FROM public.recoveries
    WHERE voucher_id = v_rec.voucher_id
      AND id <> v_rec.id;

    IF v_others > 0 THEN
      -- One shop on a shared receipt. The other shops stay on that receipt.
      DELETE FROM public.ledger_entries
      WHERE id IN (
        SELECT le.id
        FROM public.ledger_entries le
        WHERE le.ref_table = 'vouchers'
          AND le.ref_id = v_rec.voucher_id
          AND le.party_id = v_rec.party_id
          AND le.credit = v_rec.amount
        LIMIT 1
      );
      DELETE FROM public.voucher_lines
      WHERE id IN (
        SELECT vl.id
        FROM public.voucher_lines vl
        WHERE vl.voucher_id = v_rec.voucher_id
          AND vl.party_id = v_rec.party_id
          AND vl.amount = v_rec.amount
        ORDER BY vl.sort_order
        LIMIT 1
      );
      INSERT INTO public.voucher_lines (voucher_id, company_id, party_id, amount, narration, sort_order)
      VALUES (
        v_rec.voucher_id, v_company_id, v_party, v_amount, v_note,
        coalesce((
          SELECT max(sort_order) FROM public.voucher_lines WHERE voucher_id = v_rec.voucher_id
        ), -1) + 1
      );
      PERFORM private.post_ledger(
        v_org_id, v_company_id, v_party, v_date,
        0, v_amount, v_note, 'vouchers', v_rec.voucher_id, 'CR'
      );
      UPDATE public.vouchers
      SET total_amount = (
            SELECT coalesce(sum(amount), 0)
            FROM public.voucher_lines
            WHERE voucher_id = v_rec.voucher_id
          ),
          updated_at = now()
      WHERE id = v_rec.voucher_id;
    ELSE
      DELETE FROM public.ledger_entries
      WHERE ref_table = 'vouchers' AND ref_id = v_rec.voucher_id;
      DELETE FROM public.voucher_lines WHERE voucher_id = v_rec.voucher_id;
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
    END IF;
  ELSE
    DELETE FROM public.ledger_entries
    WHERE ref_table = 'recoveries' AND ref_id = v_rec.id;
    PERFORM private.post_ledger(
      v_org_id, v_company_id, v_party, v_date,
      0, v_amount, v_note, 'recoveries', v_rec.id, 'CR'
    );
  END IF;

  UPDATE public.recoveries SET
    party_id = v_party,
    recovery_date = v_date,
    amount = v_amount,
    remarks = nullif(p_payload->>'remarks', ''),
    salesman_id = nullif(p_payload->>'salesman_id', '')::uuid,
    route = coalesce(nullif(p_payload->>'route', ''), v_party_row.route),
    city = coalesce(nullif(p_payload->>'city', ''), v_party_row.city)
  WHERE id = v_rec.id;

  RETURN v_rec.id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.record_recovery_batch(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_recovery(jsonb) TO authenticated, service_role;
