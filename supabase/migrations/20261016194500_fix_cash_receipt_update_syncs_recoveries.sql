-- Orphan recoveries (no matching voucher line) inflate Last received / recovery
-- lists without touching the ledger. Remove them, then make cash-receipt edit
-- replace recoveries with the new lines.

DELETE FROM public.recoveries r
WHERE r.voucher_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.voucher_lines vl
    WHERE vl.voucher_id = r.voucher_id
      AND vl.party_id = r.party_id
      AND vl.amount = r.amount
  );

CREATE OR REPLACE FUNCTION public.update_cash_receipt(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := (p_payload->>'voucher_id')::uuid;
  v_v public.vouchers%rowtype;
  v_line jsonb;
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_date date := coalesce((p_payload->>'voucher_date')::date, current_date);
  v_total numeric := 0;
  v_idx int := 0;
  v_party uuid;
  v_amount numeric;
  v_party_row public.parties%rowtype;
BEGIN
  PERFORM set_config('app.replacing_document_lines', '1', true);
  PERFORM set_config('app.cancelling_recovery', '1', true);

  SELECT * INTO v_v FROM public.vouchers WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Voucher not found'; END IF;
  IF NOT private.can_write_company(v_v.company_id) THEN RAISE EXCEPTION 'No write access'; END IF;
  IF v_v.status <> 'posted' THEN RAISE EXCEPTION 'This voucher is already cancelled'; END IF;
  IF v_v.voucher_type <> 'CR' THEN RAISE EXCEPTION 'This is not a cash receipt'; END IF;
  IF v_company_id IS DISTINCT FROM v_v.company_id THEN RAISE EXCEPTION 'Company does not match this voucher'; END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'lines', '[]'::jsonb))
  LOOP
    v_total := v_total + COALESCE((v_line->>'amount')::numeric, 0);
  END LOOP;
  IF v_total <= 0 THEN RAISE EXCEPTION 'Receipt total must be greater than zero'; END IF;

  -- Drop linked recoveries first so Last received stays in sync with lines.
  DELETE FROM public.recoveries WHERE voucher_id = v_v.id;
  DELETE FROM public.ledger_entries WHERE ref_table = 'vouchers' AND ref_id = v_v.id;
  DELETE FROM public.voucher_lines WHERE voucher_id = v_v.id;

  UPDATE public.vouchers SET
    voucher_date = v_date,
    total_amount = v_total,
    narration = NULLIF(p_payload->>'narration',''),
    updated_at = now()
  WHERE id = v_v.id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'lines', '[]'::jsonb))
  LOOP
    v_party := (v_line->>'party_id')::uuid;
    v_amount := COALESCE((v_line->>'amount')::numeric, 0);
    INSERT INTO public.voucher_lines (voucher_id, company_id, party_id, amount, narration, sort_order)
    VALUES (
      v_v.id, v_company_id, v_party, v_amount,
      NULLIF(v_line->>'narration',''), v_idx
    );
    PERFORM private.post_ledger(
      v_org_id, v_company_id, v_party, v_date,
      0, v_amount,
      COALESCE(NULLIF(v_line->>'narration',''), 'Cash receipt ' || v_v.voucher_no),
      'vouchers', v_v.id, 'CR'
    );

    IF v_party IS NOT NULL AND v_amount > 0 THEN
      SELECT * INTO v_party_row FROM public.parties WHERE id = v_party AND company_id = v_company_id;
      IF FOUND THEN
        INSERT INTO public.recoveries (
          organization_id, company_id, party_id, recovery_date, amount, remarks,
          voucher_id, route, city, created_by
        ) VALUES (
          v_org_id, v_company_id, v_party, v_date, v_amount,
          NULLIF(v_line->>'narration',''),
          v_v.id,
          v_party_row.route,
          v_party_row.city,
          auth.uid()
        );
      END IF;
    END IF;

    v_idx := v_idx + 1;
  END LOOP;
  RETURN v_v.id;
END;
$function$;

-- Cancel every recovery line on a multi-shop cash receipt, not only the first.
CREATE OR REPLACE FUNCTION public.cancel_voucher(p_voucher_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_v public.vouchers%rowtype;
  v_line public.voucher_lines%rowtype;
  v_recovery_id uuid;
BEGIN
  SELECT * INTO v_v FROM public.vouchers WHERE id = p_voucher_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Voucher not found'; END IF;
  IF NOT private.can_write_company(v_v.company_id) THEN RAISE EXCEPTION 'No write access'; END IF;
  IF v_v.status = 'cancelled' THEN RAISE EXCEPTION 'This voucher is already cancelled'; END IF;
  IF v_v.status <> 'posted' THEN RAISE EXCEPTION 'Only posted vouchers can be cancelled'; END IF;

  IF v_v.voucher_type = 'CR' THEN
    LOOP
      SELECT r.id INTO v_recovery_id
      FROM public.recoveries r
      WHERE r.voucher_id = v_v.id
      LIMIT 1;
      EXIT WHEN v_recovery_id IS NULL;
      PERFORM public.cancel_recovery(v_recovery_id);
    END LOOP;
    SELECT * INTO v_v FROM public.vouchers WHERE id = p_voucher_id;
    IF v_v.status = 'cancelled' THEN
      RETURN;
    END IF;
  END IF;

  FOR v_line IN
    SELECT * FROM public.voucher_lines WHERE voucher_id = v_v.id ORDER BY sort_order
  LOOP
    IF v_v.voucher_type = 'CR' THEN
      PERFORM private.post_ledger(
        v_v.organization_id, v_v.company_id, v_line.party_id, v_v.voucher_date,
        v_line.amount, 0,
        'Cancel ' || coalesce(v_v.voucher_no, 'CR'),
        'vouchers', v_v.id, 'CR'
      );
    ELSIF v_v.voucher_type = 'CP' THEN
      PERFORM private.post_ledger(
        v_v.organization_id, v_v.company_id, v_line.party_id, v_v.voucher_date,
        0, v_line.amount,
        'Cancel ' || coalesce(v_v.voucher_no, 'CP'),
        'vouchers', v_v.id, 'CP'
      );
    ELSIF v_v.voucher_type = 'JV' THEN
      IF v_line.debit_party_id IS NOT NULL THEN
        PERFORM private.post_ledger(
          v_v.organization_id, v_v.company_id, v_line.debit_party_id, v_v.voucher_date,
          0, v_line.amount,
          'Cancel ' || coalesce(v_v.voucher_no, 'JV'),
          'vouchers', v_v.id, 'JV'
        );
      END IF;
      IF v_line.credit_party_id IS NOT NULL THEN
        PERFORM private.post_ledger(
          v_v.organization_id, v_v.company_id, v_line.credit_party_id, v_v.voucher_date,
          v_line.amount, 0,
          'Cancel ' || coalesce(v_v.voucher_no, 'JV'),
          'vouchers', v_v.id, 'JV'
        );
      END IF;
    END IF;
  END LOOP;

  UPDATE public.vouchers
  SET status = 'cancelled', updated_at = now()
  WHERE id = v_v.id;
END;
$function$;
