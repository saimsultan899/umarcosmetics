-- One shop = one line on a cash receipt. Duplicate party lines (top-row add +
-- sheet) made Last received show 5000 while another 2000 sat on the same CR,
-- and Edit could not show a single Received amount.
-- Merge same-party lines on create/update, and sum same-voucher recoveries for
-- Last received.

CREATE OR REPLACE FUNCTION public.create_cash_receipt(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID := (p_payload->>'company_id')::UUID;
  v_org_id UUID := (p_payload->>'organization_id')::UUID;
  v_id UUID; v_no TEXT; v_line RECORD; v_idx INT := 0;
  v_total NUMERIC := 0;
  v_date DATE := COALESCE((p_payload->>'voucher_date')::DATE, CURRENT_DATE);
  v_skip_recovery BOOLEAN := lower(COALESCE(p_payload->>'skip_recovery_rows', '')) IN ('true', 't', '1');
  v_party_row public.parties%ROWTYPE;
  v_lines JSONB;
BEGIN
  IF NOT private.can_write_company(v_company_id) THEN RAISE EXCEPTION 'No write access'; END IF;

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
    total_amount, narration, status, created_by
  ) VALUES (
    v_org_id, v_company_id, 'CR', v_no, v_date, v_total,
    NULLIF(p_payload->>'narration',''), 'posted', auth.uid()
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
          voucher_id, route, city, created_by
        ) VALUES (
          v_org_id, v_company_id, v_line.party_id, v_date, v_line.amount,
          v_line.narration,
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
          voucher_id, route, city, created_by
        ) VALUES (
          v_org_id, v_company_id, v_line.party_id, v_date, v_line.amount,
          v_line.narration,
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

CREATE OR REPLACE FUNCTION public.get_last_received_by_party(
  p_company_id uuid,
  p_as_of date DEFAULT CURRENT_DATE,
  p_from date DEFAULT NULL
)
RETURNS TABLE (
  party_id uuid,
  amount numeric,
  received_date date,
  received_at timestamptz,
  recovery_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH bounds AS (
    SELECT
      CASE
        WHEN p_from IS NOT NULL AND p_as_of IS NOT NULL AND p_from > p_as_of
          THEN p_from
        ELSE coalesce(p_as_of, CURRENT_DATE)
      END AS d_to
  ),
  events AS (
    SELECT
      r.party_id,
      sum(r.amount) AS amount,
      max(coalesce(
        nullif(r.recovery_date, 'epoch'::date),
        (timezone('Asia/Karachi', r.created_at))::date
      )) AS received_date,
      max(r.created_at) AS received_at,
      (array_agg(r.id ORDER BY r.created_at DESC))[1] AS recovery_id,
      max(r.created_at) AS sort_at
    FROM public.recoveries r
    WHERE r.company_id = p_company_id
      AND r.party_id IS NOT NULL
      AND coalesce(r.amount, 0) > 0
    GROUP BY r.party_id, coalesce(r.voucher_id, r.id)

    UNION ALL

    SELECT
      vl.party_id,
      sum(vl.amount) AS amount,
      max(coalesce(
        v.voucher_date,
        (timezone('Asia/Karachi', v.created_at))::date
      )) AS received_date,
      max(coalesce(v.created_at, v.voucher_date::timestamptz)) AS received_at,
      NULL::uuid AS recovery_id,
      max(coalesce(v.created_at, v.voucher_date::timestamptz)) AS sort_at
    FROM public.vouchers v
    JOIN public.voucher_lines vl ON vl.voucher_id = v.id
    WHERE v.company_id = p_company_id
      AND v.voucher_type = 'CR'
      AND v.status = 'posted'
      AND vl.party_id IS NOT NULL
      AND coalesce(vl.amount, 0) > 0
      AND NOT EXISTS (
        SELECT 1
        FROM public.recoveries r
        WHERE r.voucher_id = v.id
          AND r.party_id = vl.party_id
      )
    GROUP BY vl.party_id, v.id
  )
  SELECT DISTINCT ON (e.party_id)
    e.party_id,
    e.amount,
    e.received_date,
    e.received_at,
    e.recovery_id
  FROM events e
  CROSS JOIN bounds b
  WHERE (private.has_company_access(p_company_id) OR private.is_super_admin())
    AND e.received_date <= b.d_to
  ORDER BY
    e.party_id,
    e.received_date DESC,
    e.sort_at DESC NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION public.get_sector_last_received(
  p_company_id uuid,
  p_as_of date DEFAULT CURRENT_DATE,
  p_from date DEFAULT NULL
)
RETURNS TABLE (
  party_id uuid,
  amount numeric,
  received_date date,
  received_at timestamptz,
  recovery_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH bounds AS (
    SELECT coalesce(p_as_of, CURRENT_DATE) AS d_to
  ),
  events AS (
    SELECT
      r.party_id,
      sum(r.amount) AS amount,
      max(coalesce(
        r.recovery_date,
        (timezone('Asia/Karachi', r.created_at))::date
      )) AS received_date,
      max(r.created_at) AS received_at,
      (array_agg(r.id ORDER BY r.created_at DESC))[1] AS recovery_id,
      max(r.created_at) AS sort_at
    FROM public.recoveries r
    WHERE r.company_id = p_company_id
      AND r.party_id IS NOT NULL
      AND coalesce(r.amount, 0) > 0
    GROUP BY r.party_id, coalesce(r.voucher_id, r.id)

    UNION ALL

    SELECT
      vl.party_id,
      sum(vl.amount) AS amount,
      max(coalesce(
        v.voucher_date,
        (timezone('Asia/Karachi', v.created_at))::date
      )) AS received_date,
      max(coalesce(v.created_at, v.voucher_date::timestamptz)) AS received_at,
      NULL::uuid AS recovery_id,
      max(coalesce(v.created_at, v.voucher_date::timestamptz)) AS sort_at
    FROM public.vouchers v
    JOIN public.voucher_lines vl ON vl.voucher_id = v.id
    WHERE v.company_id = p_company_id
      AND v.voucher_type = 'CR'
      AND v.status = 'posted'
      AND vl.party_id IS NOT NULL
      AND coalesce(vl.amount, 0) > 0
      AND NOT EXISTS (
        SELECT 1
        FROM public.recoveries r
        WHERE r.voucher_id = v.id
          AND r.party_id = vl.party_id
      )
    GROUP BY vl.party_id, v.id
  ),
  dated AS (
    SELECT e.*, coalesce(nullif(btrim(p.route), ''), '') AS sector_key
    FROM events e
    JOIN public.parties p
      ON p.id = e.party_id
     AND p.company_id = p_company_id
    CROSS JOIN bounds b
    WHERE e.received_date <= b.d_to
      AND (p_from IS NULL OR e.received_date >= p_from)
  ),
  day_counts AS (
    SELECT sector_key, received_date, count(DISTINCT party_id) AS shop_count
    FROM dated
    GROUP BY sector_key, received_date
  ),
  sector_edge AS (
    SELECT sector_key, max(received_date) AS edge_date
    FROM day_counts
    GROUP BY sector_key
  ),
  sector_rounds AS (
    SELECT d.sector_key, max(d.received_date) AS round_date
    FROM day_counts d
    JOIN sector_edge e ON e.sector_key = d.sector_key
    WHERE d.shop_count > 1
       OR d.received_date < e.edge_date
    GROUP BY d.sector_key
  ),
  latest AS (
    SELECT DISTINCT ON (party_id)
      party_id,
      amount,
      received_date,
      received_at,
      recovery_id,
      sector_key
    FROM dated
    ORDER BY party_id, received_date DESC, sort_at DESC NULLS LAST
  )
  SELECT
    l.party_id,
    l.amount,
    l.received_date,
    l.received_at,
    l.recovery_id
  FROM latest l
  LEFT JOIN sector_rounds s ON s.sector_key = l.sector_key
  WHERE (private.has_company_access(p_company_id) OR private.is_super_admin())
    AND (s.round_date IS NULL OR l.received_date >= s.round_date);
$$;
