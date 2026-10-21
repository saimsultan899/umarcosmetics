-- Dashboard snapshot: counter cash (amount paid on today's sales) instead of
-- only exposing low-stock count in the main KPI strip.

CREATE OR REPLACE FUNCTION public.get_dashboard_snapshot(
  p_company_id uuid,
  p_date date default current_date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sales numeric;
  v_cash_sales numeric;
  v_recoveries numeric;
  v_purchases numeric;
  v_receivable numeric;
  v_payable numeric;
  v_low_stock int;
  v_over_limit int;
BEGIN
  IF NOT private.has_company_access(p_company_id) THEN
    RAISE EXCEPTION 'No access';
  END IF;

  SELECT
    coalesce(sum(grand_total), 0),
    coalesce(sum(greatest(coalesce(amount_paid, 0), 0)), 0)
  INTO v_sales, v_cash_sales
  FROM public.sale_invoices
  WHERE company_id = p_company_id
    AND invoice_date = p_date
    AND status = 'posted';

  SELECT coalesce(sum(amount), 0) INTO v_recoveries
  FROM public.recoveries
  WHERE company_id = p_company_id
    AND recovery_date = p_date;

  SELECT coalesce(sum(grand_total), 0) INTO v_purchases
  FROM public.purchase_invoices
  WHERE company_id = p_company_id
    AND invoice_date = p_date
    AND status = 'posted';

  SELECT
    coalesce(sum(greatest(balance, 0)) FILTER (
      WHERE party_subtype IN ('customer', 'both')
    ), 0),
    coalesce(sum(greatest(-balance, 0)) FILTER (
      WHERE party_subtype IN ('supplier', 'both')
    ), 0),
    count(*) FILTER (
      WHERE credit_limit > 0 AND balance > credit_limit
    )
  INTO v_receivable, v_payable, v_over_limit
  FROM (
    SELECT
      p.party_subtype,
      p.credit_limit,
      coalesce(p.opening_balance, 0) + coalesce(sum(le.debit - le.credit), 0) AS balance
    FROM public.parties p
    LEFT JOIN public.ledger_entries le
      ON le.company_id = p.company_id
     AND le.party_id = p.id
     AND le.entry_date <= p_date
    WHERE p.company_id = p_company_id
      AND p.is_active
    GROUP BY p.id, p.party_subtype, p.credit_limit, p.opening_balance
  ) balances;

  SELECT count(*) INTO v_low_stock
  FROM public.stock_balances sb
  JOIN public.products pr ON pr.id = sb.product_id
  WHERE sb.company_id = p_company_id
    AND pr.reorder_level > 0
    AND sb.qty <= pr.reorder_level;

  RETURN jsonb_build_object(
    'sales_today', v_sales,
    'cash_sales_today', v_cash_sales,
    'recoveries_today', v_recoveries,
    'purchases_today', v_purchases,
    'receivable', v_receivable,
    'payable', v_payable,
    'low_stock_count', v_low_stock,
    'over_limit_count', v_over_limit
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_snapshot(uuid, date) TO authenticated, service_role;
