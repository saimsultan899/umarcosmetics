-- Cash receipts carry the field salesman who collected the money.
-- The voucher stores it, and each recovery row written for Last received
-- stores the same id so salesman filters and reports include the receipt.

ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS salesman_id uuid REFERENCES public.salesmen(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS vouchers_company_salesman_idx
  ON public.vouchers (company_id, salesman_id)
  WHERE salesman_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_cash_receipt(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID := (p_payload->>'company_id')::UUID;
  v_org_id UUID := (p_payload->>'organization_id')::UUID;
  v_salesman_id UUID := NULLIF(p_payload->>'salesman_id', '')::UUID;
  v_id UUID; v_no TEXT; v_line RECORD; v_idx INT := 0;
  v_total NUMERIC := 0;
  v_date DATE := COALESCE((p_payload->>'voucher_date')::DATE, CURRENT_DATE);
  v_skip_recovery BOOLEAN := lower(COALESCE(p_payload->>'skip_recovery_rows', '')) IN ('true', 't', '1');
  v_party_row public.parties%ROWTYPE;
  v_lines JSONB;
BEGIN
  IF NOT private.can_write_company(v_company_id) THEN RAISE EXCEPTION 'No write access'; END IF;

  IF v_salesman_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.salesmen s
    WHERE s.id = v_salesman_id AND s.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Salesman does not belong to this company';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.sort_key), '[]'::jsonb)
  INTO v_lines
  FROM (
    SELECT
      (e.elem->>'party_id')::uuid AS party_id,
      sum(coalesce((e.elem->>'amount')::numeric, 0)) AS amount,
      nullif(
        (array_agg(nullif(e.elem->>'narration', '') ORDER BY e.ord)
          FILTER (WHERE nullif(e.elem->>'narration', '') IS NOT NULL))[1],
        ''
      ) AS narration,
      min(e.ord) AS sort_key
    FROM jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
      WITH ORDINALITY AS e(elem, ord)
    WHERE nullif(e.elem->>'party_id', '') IS NOT NULL
      AND coalesce((e.elem->>'amount')::numeric, 0) > 0
    GROUP BY (e.elem->>'party_id')::uuid
  ) m;

  SELECT coalesce(sum((x->>'amount')::numeric), 0)
  INTO v_total
  FROM jsonb_array_elements(v_lines) x;
  IF v_total <= 0 THEN RAISE EXCEPTION 'Receipt total must be greater than zero'; END IF;

  v_no := public.next_document_no(v_company_id, 'cash_receipt', NULL);
  INSERT INTO public.vouchers (
    organization_id, company_id, voucher_type, voucher_no, voucher_date,
    total_amount, narration, status, created_by, salesman_id
  ) VALUES (
    v_org_id, v_company_id, 'CR', v_no, v_date, v_total,
    NULLIF(p_payload->>'narration',''), 'posted', auth.uid(), v_salesman_id
  ) RETURNING id INTO v_id;

  FOR v_line IN
    SELECT
      (x->>'party_id')::uuid AS party_id,
      (x->>'amount')::numeric AS amount,
      nullif(x->>'narration', '') AS narration
    FROM jsonb_array_elements(v_lines) x
  LOOP
    INSERT INTO public.voucher_lines (voucher_id, company_id, party_id, amount, narration, sort_order)
    VALUES (v_id, v_company_id, v_line.party_id, v_line.amount, v_line.narration, v_idx);
    PERFORM private.post_ledger(v_org_id, v_company_id, v_line.party_id, v_date,
      0, v_line.amount,
      COALESCE(v_line.narration, 'Cash receipt ' || v_no),
      'vouchers', v_id, 'CR');

    IF NOT v_skip_recovery AND v_line.party_id IS NOT NULL AND v_line.amount > 0 THEN
      SELECT * INTO v_party_row FROM public.parties WHERE id = v_line.party_id AND company_id = v_company_id;
      IF FOUND THEN
        INSERT INTO public.recoveries (
          organization_id, company_id, party_id, recovery_date, amount, remarks,
          voucher_id, salesman_id, route, city, created_by
        ) VALUES (
          v_org_id, v_company_id, v_line.party_id, v_date, v_line.amount,
          v_line.narration,
          v_id,
          v_salesman_id,
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

CREATE OR REPLACE FUNCTION public.update_cash_receipt(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := (p_payload->>'voucher_id')::uuid;
  v_v public.vouchers%rowtype;
  v_line RECORD;
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_salesman_id uuid := NULLIF(p_payload->>'salesman_id', '')::uuid;
  v_date date := coalesce((p_payload->>'voucher_date')::date, current_date);
  v_total numeric := 0;
  v_idx int := 0;
  v_party_row public.parties%rowtype;
  v_lines jsonb;
BEGIN
  PERFORM set_config('app.replacing_document_lines', '1', true);
  PERFORM set_config('app.cancelling_recovery', '1', true);

  SELECT * INTO v_v FROM public.vouchers WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Voucher not found'; END IF;
  IF NOT private.can_write_company(v_v.company_id) THEN RAISE EXCEPTION 'No write access'; END IF;
  IF v_v.status <> 'posted' THEN RAISE EXCEPTION 'This voucher is already cancelled'; END IF;
  IF v_v.voucher_type <> 'CR' THEN RAISE EXCEPTION 'This is not a cash receipt'; END IF;
  IF v_company_id IS DISTINCT FROM v_v.company_id THEN RAISE EXCEPTION 'Company does not match this voucher'; END IF;

  IF v_salesman_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.salesmen s
    WHERE s.id = v_salesman_id AND s.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Salesman does not belong to this company';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.sort_key), '[]'::jsonb)
  INTO v_lines
  FROM (
    SELECT
      (e.elem->>'party_id')::uuid AS party_id,
      sum(coalesce((e.elem->>'amount')::numeric, 0)) AS amount,
      nullif(
        (array_agg(nullif(e.elem->>'narration', '') ORDER BY e.ord)
          FILTER (WHERE nullif(e.elem->>'narration', '') IS NOT NULL))[1],
        ''
      ) AS narration,
      min(e.ord) AS sort_key
    FROM jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
      WITH ORDINALITY AS e(elem, ord)
    WHERE nullif(e.elem->>'party_id', '') IS NOT NULL
      AND coalesce((e.elem->>'amount')::numeric, 0) > 0
    GROUP BY (e.elem->>'party_id')::uuid
  ) m;

  SELECT coalesce(sum((x->>'amount')::numeric), 0)
  INTO v_total
  FROM jsonb_array_elements(v_lines) x;
  IF v_total <= 0 THEN RAISE EXCEPTION 'Receipt total must be greater than zero'; END IF;

  DELETE FROM public.recoveries WHERE voucher_id = v_v.id;
  DELETE FROM public.ledger_entries WHERE ref_table = 'vouchers' AND ref_id = v_v.id;
  DELETE FROM public.voucher_lines WHERE voucher_id = v_v.id;

  UPDATE public.vouchers SET
    voucher_date = v_date,
    total_amount = v_total,
    narration = NULLIF(p_payload->>'narration',''),
    salesman_id = v_salesman_id,
    updated_at = now()
  WHERE id = v_v.id;

  FOR v_line IN
    SELECT
      (x->>'party_id')::uuid AS party_id,
      (x->>'amount')::numeric AS amount,
      nullif(x->>'narration', '') AS narration
    FROM jsonb_array_elements(v_lines) x
  LOOP
    INSERT INTO public.voucher_lines (voucher_id, company_id, party_id, amount, narration, sort_order)
    VALUES (
      v_v.id, v_company_id, v_line.party_id, v_line.amount,
      v_line.narration, v_idx
    );
    PERFORM private.post_ledger(
      v_org_id, v_company_id, v_line.party_id, v_date,
      0, v_line.amount,
      COALESCE(v_line.narration, 'Cash receipt ' || v_v.voucher_no),
      'vouchers', v_v.id, 'CR'
    );

    IF v_line.party_id IS NOT NULL AND v_line.amount > 0 THEN
      SELECT * INTO v_party_row FROM public.parties WHERE id = v_line.party_id AND company_id = v_company_id;
      IF FOUND THEN
        INSERT INTO public.recoveries (
          organization_id, company_id, party_id, recovery_date, amount, remarks,
          voucher_id, salesman_id, route, city, created_by
        ) VALUES (
          v_org_id, v_company_id, v_line.party_id, v_date, v_line.amount,
          v_line.narration,
          v_v.id,
          v_salesman_id,
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
