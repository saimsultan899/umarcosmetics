-- Super-admin helpers: create organization / company with defaults

CREATE OR REPLACE FUNCTION public.admin_create_organization(
  p_name text,
  p_status text DEFAULT 'active'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can create organizations';
  END IF;

  IF nullif(trim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;

  INSERT INTO public.organizations (name, status)
  VALUES (
    trim(p_name),
    CASE WHEN p_status = 'suspended' THEN 'suspended'::public.organization_status ELSE 'active'::public.organization_status END
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_company(
  p_organization_id uuid,
  p_name text,
  p_code text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_ntn text DEFAULT NULL,
  p_default_warehouse text DEFAULT 'MAIN'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_wh text := coalesce(nullif(trim(p_default_warehouse), ''), 'MAIN');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can create companies';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_organization_id) THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF nullif(trim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Company name is required';
  END IF;

  INSERT INTO public.companies (
    organization_id, name, code, address, city, phone, ntn, is_active
  )
  VALUES (
    p_organization_id,
    trim(p_name),
    nullif(trim(coalesce(p_code, '')), ''),
    nullif(trim(coalesce(p_address, '')), ''),
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_ntn, '')), ''),
    true
  )
  RETURNING id INTO v_id;

  INSERT INTO public.company_members (company_id, user_id, role, is_active)
  VALUES (v_id, v_uid, 'org_admin', true)
  ON CONFLICT (company_id, user_id) DO UPDATE
    SET role = EXCLUDED.role, is_active = true;

  INSERT INTO public.warehouses (organization_id, company_id, name, code)
  VALUES (p_organization_id, v_id, v_wh, left(upper(regexp_replace(v_wh, '[^A-Za-z0-9]', '', 'g')), 12));

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_organization(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_company(uuid, text, text, text, text, text, text, text) TO authenticated;
