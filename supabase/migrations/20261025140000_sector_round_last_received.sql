-- Last received follows the latest sector collection on or before the sheet date.
-- A shop that paid on that round shows the amount. A shop left out of that
-- round shows nothing, so the sheet prints a dash. Balances are not touched.

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
      r.amount,
      coalesce(
        r.recovery_date,
        (timezone('Asia/Karachi', r.created_at))::date
      ) AS received_date,
      r.created_at AS received_at,
      r.id AS recovery_id,
      r.created_at AS sort_at
    FROM public.recoveries r
    WHERE r.company_id = p_company_id
      AND r.party_id IS NOT NULL
      AND coalesce(r.amount, 0) > 0

    UNION ALL

    SELECT
      vl.party_id,
      vl.amount,
      coalesce(
        v.voucher_date,
        (timezone('Asia/Karachi', v.created_at))::date
      ) AS received_date,
      coalesce(v.created_at, v.voucher_date::timestamptz) AS received_at,
      NULL::uuid AS recovery_id,
      coalesce(v.created_at, v.voucher_date::timestamptz) AS sort_at
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
          AND abs(coalesce(r.amount, 0) - coalesce(vl.amount, 0)) < 0.01
      )
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
  sector_rounds AS (
    SELECT sector_key, max(received_date) AS round_date
    FROM dated
    GROUP BY sector_key
  )
  SELECT DISTINCT ON (d.party_id)
    d.party_id,
    d.amount,
    d.received_date,
    d.received_at,
    d.recovery_id
  FROM dated d
  JOIN sector_rounds s
    ON s.sector_key = d.sector_key
   AND s.round_date = d.received_date
  WHERE private.has_company_access(p_company_id) OR private.is_super_admin()
  ORDER BY
    d.party_id,
    d.received_date DESC,
    d.sort_at DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_sector_last_received(uuid, date, date)
  TO authenticated, service_role;
