-- Balance immediately before a document moment (invoice print previous balance).
CREATE OR REPLACE FUNCTION public.get_party_balance_before(
  p_company_id uuid,
  p_party_id uuid,
  p_as_of date,
  p_before timestamptz
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT opening_balance FROM public.parties
    WHERE id = p_party_id AND company_id = p_company_id
  ), 0)
  + COALESCE((
    SELECT SUM(debit - credit) FROM public.ledger_entries
    WHERE company_id = p_company_id
      AND party_id = p_party_id
      AND (
        entry_date < p_as_of
        OR (entry_date = p_as_of AND created_at < p_before)
      )
  ), 0);
$$;

GRANT EXECUTE ON FUNCTION public.get_party_balance_before(uuid, uuid, date, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_party_balance_before(uuid, uuid, date, timestamptz) TO service_role;
