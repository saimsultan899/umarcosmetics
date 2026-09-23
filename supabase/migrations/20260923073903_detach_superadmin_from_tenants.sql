-- Platform superadmins must not be tenant users.
-- Detach every is_super_admin profile from company memberships and clear
-- their active company so login never lands on a distributor dashboard.

DELETE FROM public.company_members cm
USING public.profiles p
WHERE cm.user_id = p.id
  AND p.is_super_admin = true;

UPDATE public.profiles
SET
  active_company_id = NULL,
  organization_id = NULL
WHERE is_super_admin = true;

-- Keep platform accounts out of tenant membership going forward.
CREATE OR REPLACE FUNCTION private.block_superadmin_company_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = NEW.user_id
      AND p.is_super_admin = true
  ) THEN
    RAISE EXCEPTION 'Platform superadmin accounts cannot join companies';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_superadmin_company_membership ON public.company_members;
CREATE TRIGGER trg_block_superadmin_company_membership
  BEFORE INSERT OR UPDATE OF user_id ON public.company_members
  FOR EACH ROW
  EXECUTE FUNCTION private.block_superadmin_company_membership();

-- Private helper: no direct client execute.
REVOKE ALL ON FUNCTION private.block_superadmin_company_membership() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.block_superadmin_company_membership() FROM anon, authenticated;
