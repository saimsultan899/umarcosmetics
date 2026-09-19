-- Super-admin: company create without auto-membership; attach/detach members

CREATE OR REPLACE FUNCTION public.admin_create_company(
  p_organization_id uuid,
  p_name text,
  p_code text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_ntn text DEFAULT NULL,
  p_default_warehouse text DEFAULT 'MAIN',
  p_attach_caller boolean DEFAULT false
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

  IF p_attach_caller THEN
    INSERT INTO public.company_members (company_id, user_id, role, is_active)
    VALUES (v_id, v_uid, 'org_admin', true)
    ON CONFLICT (company_id, user_id) DO UPDATE
      SET role = EXCLUDED.role, is_active = true;
  END IF;

  INSERT INTO public.warehouses (organization_id, company_id, name, code)
  VALUES (
    p_organization_id,
    v_id,
    v_wh,
    left(upper(regexp_replace(v_wh, '[^A-Za-z0-9]', '', 'g')), 12)
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_attach_member(
  p_company_id uuid,
  p_user_id uuid,
  p_role public.app_role DEFAULT 'org_admin',
  p_is_active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can attach members';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id) THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id) THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  IF p_role = 'super_admin' THEN
    RAISE EXCEPTION 'Cannot assign super_admin via membership';
  END IF;

  INSERT INTO public.company_members (company_id, user_id, role, is_active)
  VALUES (p_company_id, p_user_id, p_role, coalesce(p_is_active, true))
  ON CONFLICT (company_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        is_active = EXCLUDED.is_active
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_detach_member(
  p_company_id uuid,
  p_user_id uuid,
  p_hard_delete boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can detach members';
  END IF;

  IF p_hard_delete THEN
    DELETE FROM public.company_members
    WHERE company_id = p_company_id AND user_id = p_user_id;
  ELSE
    UPDATE public.company_members
    SET is_active = false
    WHERE company_id = p_company_id AND user_id = p_user_id;
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_company(uuid, text, text, text, text, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_attach_member(uuid, uuid, public.app_role, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_detach_member(uuid, uuid, boolean) TO authenticated;

-- Remove legacy 8-arg overload that always attached the calling superadmin
DROP FUNCTION IF EXISTS public.admin_create_company(uuid, text, text, text, text, text, text, text);
