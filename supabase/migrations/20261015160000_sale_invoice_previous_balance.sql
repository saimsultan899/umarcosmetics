-- Sale invoice print: previous balance should match the ledger excluding this bill.
-- Same-day recoveries after the bill was first saved still clear previous dues on reprint.
CREATE OR REPLACE FUNCTION public.get_party_balance_before_sale(
  p_company_id uuid,
  p_party_id uuid,
  p_as_of date,
  p_before timestamptz,
  p_sale_invoice_id uuid
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
      AND NOT (
        ref_table = 'sale_invoices'
        AND ref_id = p_sale_invoice_id
      )
      AND (
        entry_date < p_as_of
        OR (
          entry_date = p_as_of
          AND (
            created_at < p_before
            OR voucher_type = 'CR'
          )
        )
      )
  ), 0);
$$;

GRANT EXECUTE ON FUNCTION public.get_party_balance_before_sale(
  uuid, uuid, date, timestamptz, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_party_balance_before_sale(
  uuid, uuid, date, timestamptz, uuid
) TO service_role;
