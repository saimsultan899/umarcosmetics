-- Durable "Last received" for Customer Receivables.
-- Client-side paging of recoveries kept missing shops; wrong bill dates also
-- hid rows when only recovery_date was compared to the sheet's as-of date.
-- One SECURITY DEFINER RPC returns the latest collection per party using
-- max(bill date, Pakistan save date), plus posted CR lines that lack a
-- recovery row.

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
  SELECT DISTINCT ON (x.party_id)
    x.party_id,
    x.amount,
    x.received_date,
    x.received_at,
    x.recovery_id
  FROM (
    SELECT
      r.party_id,
      r.amount,
      r.recovery_date AS bill_date,
      GREATEST(
        r.recovery_date,
        (timezone('Asia/Karachi', r.created_at))::date
      ) AS received_date,
      r.created_at AS received_at,
      r.id AS recovery_id
    FROM public.recoveries r
    WHERE r.company_id = p_company_id
      AND r.party_id IS NOT NULL
      AND coalesce(r.amount, 0) > 0
      AND GREATEST(
        r.recovery_date,
        (timezone('Asia/Karachi', r.created_at))::date
      ) <= p_as_of

    UNION ALL

    -- Posted cash-receipt lines that never got a recoveries row.
    SELECT
      vl.party_id,
      vl.amount,
      v.voucher_date AS bill_date,
      GREATEST(
        v.voucher_date,
        (timezone('Asia/Karachi', v.created_at))::date
      ) AS received_date,
      coalesce(v.created_at, v.voucher_date::timestamptz) AS received_at,
      NULL::uuid AS recovery_id
    FROM public.vouchers v
    JOIN public.voucher_lines vl ON vl.voucher_id = v.id
    WHERE v.company_id = p_company_id
      AND v.voucher_type = 'CR'
      AND v.status = 'posted'
      AND vl.party_id IS NOT NULL
      AND coalesce(vl.amount, 0) > 0
      AND GREATEST(
        v.voucher_date,
        (timezone('Asia/Karachi', v.created_at))::date
      ) <= p_as_of
      AND NOT EXISTS (
        SELECT 1
        FROM public.recoveries r
        WHERE r.voucher_id = v.id
          AND r.party_id = vl.party_id
          AND abs(coalesce(r.amount, 0) - coalesce(vl.amount, 0)) < 0.01
      )
  ) x
  WHERE private.has_company_access(p_company_id)
     OR private.is_super_admin()
  ORDER BY
    x.party_id,
    x.received_date DESC,
    x.received_at DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_last_received_by_party(uuid, date)
  TO authenticated, service_role;

-- Re-backfill any posted CR lines still missing recoveries.
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
      AND abs(coalesce(r.amount, 0) - coalesce(vl.amount, 0)) < 0.01
  );
