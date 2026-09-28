-- Per-user permission keys. NULL follows the role template.
-- Hard deletes of masters and posted financial documents are rejected.

ALTER TABLE public.company_members
  ADD COLUMN IF NOT EXISTS permissions text[];

COMMENT ON COLUMN public.company_members.permissions IS
  'Exact permission keys for this member. NULL follows the role template. An empty array grants nothing.';

CREATE OR REPLACE FUNCTION private.all_permission_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'create_invoices',
    'create_purchases',
    'create_vouchers',
    'edit_products',
    'edit_customers',
    'inactivate_records',
    'view_reports',
    'manage_users'
  ]::text[];
$$;

CREATE OR REPLACE FUNCTION private.role_permission_keys(p_role text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_role
    WHEN 'super_admin' THEN private.all_permission_keys()
    WHEN 'org_admin' THEN private.all_permission_keys()
    WHEN 'company_admin' THEN private.all_permission_keys()
    WHEN 'accountant' THEN ARRAY[
      'create_invoices',
      'create_vouchers',
      'edit_customers',
      'view_reports'
    ]::text[]
    WHEN 'inventory' THEN ARRAY[
      'create_purchases',
      'edit_products',
      'inactivate_records',
      'view_reports'
    ]::text[]
    WHEN 'sales_desk' THEN ARRAY['create_invoices', 'view_reports']::text[]
    WHEN 'salesman' THEN ARRAY['create_invoices']::text[]
    WHEN 'viewer' THEN ARRAY['view_reports']::text[]
    ELSE ARRAY[]::text[]
  END;
$$;

CREATE OR REPLACE FUNCTION private.has_permission(p_company_id uuid, p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
SET row_security TO off
AS $$
DECLARE
  v_role text;
  v_perms text[];
BEGIN
  IF private.is_super_admin() THEN
    RETURN true;
  END IF;
  IF auth.uid() IS NULL OR p_company_id IS NULL OR p_key IS NULL THEN
    RETURN false;
  END IF;

  SELECT cm.role::text, cm.permissions
    INTO v_role, v_perms
  FROM public.company_members cm
  WHERE cm.user_id = auth.uid()
    AND cm.company_id = p_company_id
    AND cm.is_active
  LIMIT 1;

  IF v_role IS NULL THEN
    RETURN false;
  END IF;
  IF v_perms IS NULL THEN
    v_perms := private.role_permission_keys(v_role);
  END IF;
  RETURN p_key = ANY (v_perms);
END;
$$;

REVOKE ALL ON FUNCTION private.has_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_permission(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION private.guard_member_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
SET row_security TO off
AS $$
DECLARE
  v_key text;
BEGIN
  IF NEW.permissions IS NOT NULL THEN
    FOREACH v_key IN ARRAY NEW.permissions LOOP
      IF NOT (v_key = ANY (private.all_permission_keys())) THEN
        RAISE EXCEPTION 'Unknown permission: %', v_key
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  IF auth.uid() IS NULL OR private.is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT private.has_permission(NEW.company_id, 'manage_users') THEN
      RAISE EXCEPTION 'You do not have permission to manage users.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.role IS DISTINCT FROM NEW.role
     OR OLD.is_active IS DISTINCT FROM NEW.is_active
     OR OLD.permissions IS DISTINCT FROM NEW.permissions THEN
    IF OLD.user_id = auth.uid() THEN
      RAISE EXCEPTION 'You cannot change your own access.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT private.has_permission(OLD.company_id, 'manage_users') THEN
      RAISE EXCEPTION 'You do not have permission to manage users.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_member_access ON public.company_members;
CREATE TRIGGER trg_guard_member_access
  BEFORE INSERT OR UPDATE ON public.company_members
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_member_access();

CREATE OR REPLACE FUNCTION private.guard_record_permission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $$
DECLARE
  v_key text;
  v_company_id uuid;
  v_status_changed boolean;
  v_fields_changed boolean;
BEGIN
  IF auth.uid() IS NULL OR private.is_super_admin() THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME IN ('products', 'parties') THEN
      RAISE EXCEPTION 'Products and customers cannot be deleted. Mark them inactive instead.'
        USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'Posted sales, purchases, vouchers, and returns cannot be deleted. Correct them with a return or a reversal.'
      USING ERRCODE = '42501';
  END IF;

  v_company_id := NEW.company_id;

  IF TG_OP = 'INSERT' THEN
    v_key := CASE TG_TABLE_NAME
      WHEN 'products' THEN 'edit_products'
      WHEN 'parties' THEN 'edit_customers'
      WHEN 'sale_invoices' THEN 'create_invoices'
      WHEN 'sale_returns' THEN 'create_invoices'
      WHEN 'purchase_invoices' THEN 'create_purchases'
      WHEN 'purchase_returns' THEN 'create_purchases'
      WHEN 'vouchers' THEN 'create_vouchers'
      ELSE NULL
    END;
    IF v_key IS NOT NULL AND NOT private.has_permission(v_company_id, v_key) THEN
      RAISE EXCEPTION 'You do not have permission for this action.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME IN ('products', 'parties') AND TG_OP = 'UPDATE' THEN
    v_status_changed := OLD.is_active IS DISTINCT FROM NEW.is_active;
    v_fields_changed := (to_jsonb(NEW) - 'is_active' - 'updated_at')
      IS DISTINCT FROM (to_jsonb(OLD) - 'is_active' - 'updated_at');
    IF v_status_changed
       AND NOT private.has_permission(v_company_id, 'inactivate_records') THEN
      RAISE EXCEPTION 'You do not have permission to inactivate records.'
        USING ERRCODE = '42501';
    END IF;
    IF v_fields_changed AND NOT private.has_permission(
      v_company_id,
      CASE
        WHEN TG_TABLE_NAME = 'products' THEN 'edit_products'
        ELSE 'edit_customers'
      END
    ) THEN
      RAISE EXCEPTION 'You do not have permission to edit this record.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_products ON public.products;
CREATE TRIGGER trg_guard_products
  BEFORE INSERT OR UPDATE OR DELETE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record_permission();

DROP TRIGGER IF EXISTS trg_guard_parties ON public.parties;
CREATE TRIGGER trg_guard_parties
  BEFORE INSERT OR UPDATE OR DELETE ON public.parties
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record_permission();

DROP TRIGGER IF EXISTS trg_guard_sale_invoices ON public.sale_invoices;
CREATE TRIGGER trg_guard_sale_invoices
  BEFORE INSERT OR DELETE ON public.sale_invoices
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record_permission();

DROP TRIGGER IF EXISTS trg_guard_purchase_invoices ON public.purchase_invoices;
CREATE TRIGGER trg_guard_purchase_invoices
  BEFORE INSERT OR DELETE ON public.purchase_invoices
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record_permission();

DROP TRIGGER IF EXISTS trg_guard_vouchers ON public.vouchers;
CREATE TRIGGER trg_guard_vouchers
  BEFORE INSERT OR DELETE ON public.vouchers
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record_permission();

DROP TRIGGER IF EXISTS trg_guard_sale_returns ON public.sale_returns;
CREATE TRIGGER trg_guard_sale_returns
  BEFORE INSERT OR DELETE ON public.sale_returns
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record_permission();

DROP TRIGGER IF EXISTS trg_guard_purchase_returns ON public.purchase_returns;
CREATE TRIGGER trg_guard_purchase_returns
  BEFORE INSERT OR DELETE ON public.purchase_returns
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record_permission();

DROP TRIGGER IF EXISTS trg_guard_recoveries ON public.recoveries;
CREATE TRIGGER trg_guard_recoveries
  BEFORE DELETE ON public.recoveries
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record_permission();

DROP TRIGGER IF EXISTS trg_guard_sale_invoice_items ON public.sale_invoice_items;
CREATE TRIGGER trg_guard_sale_invoice_items
  BEFORE DELETE ON public.sale_invoice_items
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record_permission();

DROP TRIGGER IF EXISTS trg_guard_purchase_invoice_items ON public.purchase_invoice_items;
CREATE TRIGGER trg_guard_purchase_invoice_items
  BEFORE DELETE ON public.purchase_invoice_items
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record_permission();

DROP TRIGGER IF EXISTS trg_guard_voucher_lines ON public.voucher_lines;
CREATE TRIGGER trg_guard_voucher_lines
  BEFORE DELETE ON public.voucher_lines
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record_permission();

DROP TRIGGER IF EXISTS trg_guard_sale_return_items ON public.sale_return_items;
CREATE TRIGGER trg_guard_sale_return_items
  BEFORE DELETE ON public.sale_return_items
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record_permission();

DROP TRIGGER IF EXISTS trg_guard_purchase_return_items ON public.purchase_return_items;
CREATE TRIGGER trg_guard_purchase_return_items
  BEFORE DELETE ON public.purchase_return_items
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record_permission();

DROP POLICY IF EXISTS company_members_update ON public.company_members;
CREATE POLICY company_members_update ON public.company_members
  FOR UPDATE TO authenticated
  USING (
    private.is_super_admin()
    OR private.has_permission(company_id, 'manage_users')
  )
  WITH CHECK (
    private.is_super_admin()
    OR private.has_permission(company_id, 'manage_users')
  );

DROP POLICY IF EXISTS company_members_insert ON public.company_members;
CREATE POLICY company_members_insert ON public.company_members
  FOR INSERT TO authenticated
  WITH CHECK (
    private.is_super_admin()
    OR private.has_permission(company_id, 'manage_users')
  );

REVOKE ALL ON FUNCTION private.guard_member_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.guard_record_permission() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.guard_member_access() TO authenticated;
GRANT EXECUTE ON FUNCTION private.guard_record_permission() TO authenticated;
