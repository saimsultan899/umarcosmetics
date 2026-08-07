-- Prevent direct client manipulation of stock; RPCs use SECURITY DEFINER
DROP POLICY IF EXISTS stock_insert ON public.stock_balances;
DROP POLICY IF EXISTS stock_update ON public.stock_balances;
DROP POLICY IF EXISTS stock_delete ON public.stock_balances;

-- Keep SELECT for company members (policy name may already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stock_balances' AND policyname = 'stock_select'
  ) THEN
    CREATE POLICY stock_select ON public.stock_balances
      FOR SELECT TO authenticated
      USING (private.has_company_access(company_id));
  END IF;
END;
$$;
