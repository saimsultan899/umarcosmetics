-- Enforce inactive company / suspended org cannot be opened or used

CREATE OR REPLACE FUNCTION private.company_is_usable(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.companies c
    JOIN public.organizations o ON o.id = c.organization_id
    WHERE c.id = cid
      AND c.is_active = true
      AND o.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION private.has_company_access(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT private.company_is_usable(cid)
    AND (
      private.is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.company_members cm
        WHERE cm.user_id = auth.uid()
          AND cm.company_id = cid
          AND cm.is_active = true
      )
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        JOIN public.companies c ON c.organization_id = p.organization_id
        WHERE p.id = auth.uid()
          AND p.is_super_admin = false
          AND c.id = cid
          AND EXISTS (
            SELECT 1 FROM public.company_members cm2
            JOIN public.companies c2 ON c2.id = cm2.company_id
            WHERE cm2.user_id = p.id
              AND cm2.role IN ('org_admin', 'company_admin')
              AND cm2.is_active = true
              AND c2.organization_id = p.organization_id
          )
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.set_active_company(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT private.company_is_usable(p_company_id) THEN
    RAISE EXCEPTION 'Company is inactive or organization is suspended';
  END IF;

  IF NOT private.is_super_admin()
     AND NOT EXISTS (
       SELECT 1 FROM public.company_members cm
       WHERE cm.user_id = auth.uid()
         AND cm.company_id = p_company_id
         AND cm.is_active = true
     )
  THEN
    RAISE EXCEPTION 'No access to this company';
  END IF;

  UPDATE public.profiles
  SET active_company_id = p_company_id,
      organization_id = (SELECT organization_id FROM public.companies WHERE id = p_company_id)
  WHERE id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_company_active(
  p_company_id uuid,
  p_is_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can change company status';
  END IF;

  UPDATE public.companies
  SET is_active = coalesce(p_is_active, false)
  WHERE id = p_company_id;

  IF NOT found THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  IF NOT coalesce(p_is_active, false) THEN
    UPDATE public.profiles
    SET active_company_id = NULL
    WHERE active_company_id = p_company_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_organization_status(
  p_organization_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status public.org_status;
BEGIN
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can change organization status';
  END IF;

  IF lower(trim(coalesce(p_status, ''))) = 'suspended' THEN
    v_status := 'suspended'::public.org_status;
  ELSE
    v_status := 'active'::public.org_status;
  END IF;

  UPDATE public.organizations
  SET status = v_status
  WHERE id = p_organization_id;

  IF NOT found THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF v_status = 'suspended'::public.org_status THEN
    UPDATE public.profiles p
    SET active_company_id = NULL
    WHERE p.active_company_id IN (
      SELECT c.id FROM public.companies c
      WHERE c.organization_id = p_organization_id
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_active_company(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_company_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_organization_status(uuid, text) TO authenticated;
