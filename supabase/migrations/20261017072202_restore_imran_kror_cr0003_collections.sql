-- Re-post Karor Lal Esan collections wiped when cancelled CR-0003 orphan
-- recoveries were cleaned up. Skip shops that already have a posted recovery
-- (e.g. 3 Brothers already re-entered on CR-0034).

DO $$
DECLARE
  v_org uuid := 'e465f658-297c-40f9-9e7c-35250d93f53d';
  v_company uuid := 'db7c712e-ba2e-4635-95d6-8b5b2cb3dacd';
  v_old uuid;
  v_date date;
  v_id uuid;
  v_no text;
  v_total numeric := 0;
  v_idx int := 0;
  line_row record;
  v_party public.parties%ROWTYPE;
  v_next int;
BEGIN
  SELECT id, voucher_date INTO v_old, v_date
  FROM public.vouchers
  WHERE company_id = v_company AND voucher_no = 'CR-0003' AND voucher_type = 'CR'
  LIMIT 1;

  IF v_old IS NULL THEN
    RAISE NOTICE 'CR-0003 not found — nothing to restore';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.vouchers
    WHERE company_id = v_company
      AND voucher_type = 'CR'
      AND status = 'posted'
      AND narration = 'Restore Karor collections from cancelled CR-0003'
  ) THEN
    RAISE NOTICE 'Restore CR already exists — skip';
    RETURN;
  END IF;

  SELECT coalesce(next_number, 1) INTO v_next
  FROM public.document_series
  WHERE company_id = v_company AND series_type = 'cash_receipt'
  FOR UPDATE;

  IF v_next IS NULL THEN
    SELECT coalesce(max(
      CASE WHEN voucher_no ~ '^CR-[0-9]+$'
        THEN substring(voucher_no from 4)::int END
    ), 0) + 1 INTO v_next
    FROM public.vouchers
    WHERE company_id = v_company AND voucher_type = 'CR';
  END IF;

  v_no := 'CR-' || lpad(v_next::text, 4, '0');

  CREATE TEMP TABLE tmp_restore_lines ON COMMIT DROP AS
  WITH credits AS (
    SELECT le.party_id, sum(le.credit) AS amount,
      max(nullif(le.narration, '')) FILTER (
        WHERE le.narration IS NOT NULL
          AND le.narration NOT ILIKE 'Cash receipt%'
          AND le.narration NOT ILIKE 'Cancel%'
      ) AS remark
    FROM public.ledger_entries le
    WHERE le.ref_table = 'vouchers' AND le.ref_id = v_old AND le.credit > 0
    GROUP BY le.party_id
  ),
  debits AS (
    SELECT le.party_id, sum(le.debit) AS amount
    FROM public.ledger_entries le
    WHERE le.ref_table = 'vouchers' AND le.ref_id = v_old AND le.debit > 0
    GROUP BY le.party_id
  )
  SELECT c.party_id, c.amount, c.remark
  FROM credits c
  JOIN debits d ON d.party_id = c.party_id AND abs(d.amount - c.amount) < 0.01
  WHERE c.amount > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.recoveries rec
      WHERE rec.party_id = c.party_id AND coalesce(rec.amount, 0) > 0
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.vouchers vv
      JOIN public.voucher_lines vl ON vl.voucher_id = vv.id
      WHERE vl.party_id = c.party_id
        AND vv.company_id = v_company
        AND vv.voucher_type = 'CR'
        AND vv.status = 'posted'
        AND coalesce(vl.amount, 0) > 0
    );

  SELECT coalesce(sum(amount), 0) INTO v_total FROM tmp_restore_lines;
  IF v_total <= 0 THEN
    RAISE NOTICE 'No lines to restore';
    RETURN;
  END IF;

  INSERT INTO public.vouchers (
    organization_id, company_id, voucher_type, voucher_no, voucher_date,
    total_amount, narration, status, created_at, updated_at
  ) VALUES (
    v_org, v_company, 'CR', v_no, v_date,
    v_total,
    'Restore Karor collections from cancelled CR-0003',
    'posted', now(), now()
  ) RETURNING id INTO v_id;

  UPDATE public.document_series
  SET next_number = v_next + 1
  WHERE company_id = v_company AND series_type = 'cash_receipt';

  FOR line_row IN
    SELECT party_id, amount, remark FROM tmp_restore_lines ORDER BY party_id
  LOOP
    INSERT INTO public.voucher_lines (
      voucher_id, company_id, party_id, amount, narration, sort_order
    ) VALUES (
      v_id, v_company, line_row.party_id, line_row.amount, line_row.remark, v_idx
    );

    PERFORM private.post_ledger(
      v_org, v_company, line_row.party_id, v_date,
      0, line_row.amount,
      coalesce(line_row.remark, 'Cash receipt ' || v_no),
      'vouchers', v_id, 'CR'
    );

    SELECT * INTO v_party FROM public.parties
    WHERE id = line_row.party_id AND company_id = v_company;
    IF FOUND THEN
      INSERT INTO public.recoveries (
        organization_id, company_id, party_id, recovery_date, amount, remarks,
        voucher_id, route, city, created_at
      ) VALUES (
        v_org, v_company, line_row.party_id, v_date, line_row.amount, line_row.remark,
        v_id, v_party.route, v_party.city, now()
      );
    END IF;

    v_idx := v_idx + 1;
  END LOOP;

  RAISE NOTICE 'Restored % lines as % total %', v_idx, v_no, v_total;
END $$;
