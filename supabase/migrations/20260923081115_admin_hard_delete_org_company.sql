-- Permanent delete for platform superadmin (trash icon).
-- Active / Suspend stays on the Edit form via existing status RPCs.
-- SECURITY DEFINER so deletes bypass tenant RLS; gated by private.is_super_admin().

CREATE OR REPLACE FUNCTION public.admin_delete_company(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can delete companies';
  END IF;

  SELECT name INTO v_name FROM public.companies WHERE id = p_company_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  -- Refuse when transactional history exists — use Inactive instead.
  IF EXISTS (SELECT 1 FROM public.sale_invoices WHERE company_id = p_company_id)
     OR EXISTS (SELECT 1 FROM public.sale_returns WHERE company_id = p_company_id)
     OR EXISTS (SELECT 1 FROM public.purchase_invoices WHERE company_id = p_company_id)
     OR EXISTS (SELECT 1 FROM public.purchase_returns WHERE company_id = p_company_id)
     OR EXISTS (SELECT 1 FROM public.vouchers WHERE company_id = p_company_id)
     OR EXISTS (SELECT 1 FROM public.recoveries WHERE company_id = p_company_id)
     OR EXISTS (SELECT 1 FROM public.expenses WHERE company_id = p_company_id)
     OR EXISTS (SELECT 1 FROM public.stock_transfers WHERE company_id = p_company_id)
     OR EXISTS (SELECT 1 FROM public.load_sheets WHERE company_id = p_company_id)
     OR EXISTS (SELECT 1 FROM public.gate_passes WHERE company_id = p_company_id)
     OR EXISTS (SELECT 1 FROM public.expiry_receipts WHERE company_id = p_company_id)
     OR EXISTS (SELECT 1 FROM public.expiry_claims WHERE company_id = p_company_id)
     OR EXISTS (SELECT 1 FROM public.expiry_settlements WHERE company_id = p_company_id)
  THEN
    RAISE EXCEPTION
      'Cannot permanently delete "%" — it has invoices or other transactions. Set it Inactive from Edit instead.',
      v_name;
  END IF;

  UPDATE public.profiles
  SET active_company_id = NULL
  WHERE active_company_id = p_company_id;

  DELETE FROM public.company_members WHERE company_id = p_company_id;
  DELETE FROM public.notifications WHERE company_id = p_company_id;
  DELETE FROM public.sync_sessions WHERE company_id = p_company_id;
  DELETE FROM public.day_closings WHERE company_id = p_company_id;
  DELETE FROM public.salesman_invites WHERE company_id = p_company_id;
  DELETE FROM public.salesman_routes WHERE company_id = p_company_id;
  DELETE FROM public.salesmen WHERE company_id = p_company_id;
  DELETE FROM public.company_locations WHERE company_id = p_company_id;
  DELETE FROM public.document_series WHERE company_id = p_company_id;
  DELETE FROM public.stock_movements WHERE company_id = p_company_id;
  DELETE FROM public.stock_balances WHERE company_id = p_company_id;
  DELETE FROM public.expiry_stock_movements WHERE company_id = p_company_id;
  DELETE FROM public.expiry_stock_balances WHERE company_id = p_company_id;
  DELETE FROM public.product_rate_slabs WHERE company_id = p_company_id;
  DELETE FROM public.products WHERE company_id = p_company_id;
  DELETE FROM public.parties WHERE company_id = p_company_id;
  DELETE FROM public.warehouses WHERE company_id = p_company_id;

  DELETE FROM public.companies WHERE id = p_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_organization(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text;
  r record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can delete organizations';
  END IF;

  SELECT name INTO v_name FROM public.organizations WHERE id = p_organization_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  -- Delete every company first (each call enforces the transaction guard).
  FOR r IN
    SELECT id FROM public.companies WHERE organization_id = p_organization_id
  LOOP
    PERFORM public.admin_delete_company(r.id);
  END LOOP;

  UPDATE public.profiles
  SET organization_id = NULL
  WHERE organization_id = p_organization_id;

  DELETE FROM public.organizations WHERE id = p_organization_id;
END;
$$;

-- Lock down execute: authenticated superadmins only (function still checks is_super_admin).
REVOKE ALL ON FUNCTION public.admin_delete_company(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_company(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_company(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_company(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.admin_delete_organization(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_organization(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_organization(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_organization(uuid) TO service_role;
