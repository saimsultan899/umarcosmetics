-- Last received stays as-of To date (From is for brand/warehouse scope only).
-- Normalize swapped from/to if the 3-arg form is used. Prefer bill/voucher date
-- for the as-of cutoff so To date matches the document date users pick.

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

CREATE OR REPLACE FUNCTION public.get_last_received_by_party(
  p_company_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
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
  SELECT * FROM public.get_last_received_by_party(p_company_id, p_as_of, NULL::date);
$$;

GRANT EXECUTE ON FUNCTION public.get_last_received_by_party(uuid, date, date)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_last_received_by_party(uuid, date)
  TO authenticated, service_role;
