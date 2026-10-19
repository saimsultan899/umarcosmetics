-- Copy Imran Traders sector (route) + shop arrangement (sort_order) onto
-- Ishaq Enterprises and Umar Cosmetic. Insert missing shops as masters only
-- (opening_balance=0). Never change opening balances or post ledger/docs.
-- Hub mirroring disabled so spoke updates do not write back to Imran.
--
-- Already applied on remote as sync_imran_sectors_shop_arrangement_to_spokes.
-- Idempotent: re-running only refreshes route/sort_order and inserts still-missing codes.

DO $$
DECLARE
  v_imran uuid := 'db7c712e-ba2e-4635-95d6-8b5b2cb3dacd';
  v_org uuid := 'e465f658-297c-40f9-9e7c-35250d93f53d';
  v_targets uuid[] := ARRAY[
    'd2b39f4c-0cf0-4757-8a12-6be192d95590'::uuid, -- Ishaq
    '326ea1cf-f735-4d03-8e00-728172ce3312'::uuid  -- Umar Cosmetic
  ];
  v_target uuid;
  v_max_ord int;
  v_updated int;
  v_inserted int;
  v_ob_before numeric;
  v_ob_after numeric;
BEGIN
  PERFORM private.set_hub_mirroring(true);

  FOREACH v_target IN ARRAY v_targets
  LOOP
    SELECT coalesce(sum(opening_balance), 0) INTO v_ob_before
    FROM public.parties WHERE company_id = v_target;

    UPDATE public.parties AS t
    SET
      route = s.route,
      sort_order = CASE WHEN coalesce(s.sort_order, 0) <= 0 THEN 1 ELSE s.sort_order END,
      hub_party_id = s.id,
      -- If Imran has the shop active, bring an existing inactive target row back
      -- without touching opening_balance.
      is_active = CASE WHEN s.is_active THEN true ELSE t.is_active END,
      updated_at = now()
    FROM public.parties AS s
    WHERE s.company_id = v_imran
      AND s.is_active
      AND s.party_subtype IN ('customer', 'both')
      AND t.company_id = v_target
      AND t.party_code = s.party_code
      AND t.party_subtype IN ('customer', 'both');

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    INSERT INTO public.parties (
      organization_id, company_id, party_code, name_en, name_ur,
      party_type, party_subtype, address, sub_head, city, head, route,
      phone, mobile, contact_person, ntn,
      opening_balance, credit_limit, sale_channel, is_active,
      hub_party_id, sort_order
    )
    SELECT
      v_org,
      v_target,
      s.party_code,
      s.name_en,
      s.name_ur,
      s.party_type,
      s.party_subtype,
      s.address,
      s.sub_head,
      s.city,
      s.head,
      s.route,
      s.phone,
      s.mobile,
      s.contact_person,
      s.ntn,
      0,
      0,
      s.sale_channel,
      true,
      s.id,
      CASE WHEN coalesce(s.sort_order, 0) <= 0 THEN 1 ELSE s.sort_order END
    FROM public.parties s
    WHERE s.company_id = v_imran
      AND s.is_active
      AND s.party_subtype IN ('customer', 'both')
      AND NOT EXISTS (
        SELECT 1
        FROM public.parties t
        WHERE t.company_id = v_target
          AND t.party_code = s.party_code
      );

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    SELECT coalesce(max(sort_order), 0) INTO v_max_ord
    FROM public.parties
    WHERE company_id = v_imran
      AND is_active
      AND party_subtype IN ('customer', 'both');

    UPDATE public.parties AS t
    SET
      sort_order = v_max_ord + sub.rn,
      updated_at = now()
    FROM (
      SELECT
        t2.id,
        row_number() OVER (ORDER BY t2.sort_order, t2.party_code, t2.name_en) AS rn
      FROM public.parties t2
      WHERE t2.company_id = v_target
        AND t2.is_active
        AND t2.party_subtype IN ('customer', 'both')
        AND NOT EXISTS (
          SELECT 1
          FROM public.parties s
          WHERE s.company_id = v_imran
            AND s.party_code = t2.party_code
        )
    ) AS sub
    WHERE t.id = sub.id;

    UPDATE public.document_series ds
    SET next_number = greatest(
      coalesce(ds.next_number, 1),
      coalesce((
        SELECT max(p.party_code::int)
        FROM public.parties p
        WHERE p.company_id = v_target
          AND p.party_code ~ '^[0-9]+$'
      ), 0) + 1
    )
    WHERE ds.company_id = v_target
      AND ds.series_type = 'party';

    SELECT coalesce(sum(opening_balance), 0) INTO v_ob_after
    FROM public.parties WHERE company_id = v_target;

    IF v_ob_after IS DISTINCT FROM v_ob_before THEN
      RAISE EXCEPTION 'Opening balances changed for company % (before %, after %)',
        v_target, v_ob_before, v_ob_after;
    END IF;

    RAISE NOTICE 'company % updated=% inserted=% opening_balance_sum=%',
      v_target, v_updated, v_inserted, v_ob_after;
  END LOOP;

  PERFORM private.set_hub_mirroring(false);
END $$;
