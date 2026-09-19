-- organizations.status uses public.org_status (not organization_status)
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
    CASE
      WHEN lower(trim(coalesce(p_status, 'active'))) = 'suspended'
        THEN 'suspended'::public.org_status
      ELSE 'active'::public.org_status
    END
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_organization(text, text) TO authenticated;
