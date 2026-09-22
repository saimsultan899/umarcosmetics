-- Performance: stop re-evaluating auth.uid() per row in RLS policies.
-- Wrapping auth.uid() in a scalar subselect lets Postgres evaluate it once
-- per statement (initplan) instead of once per row. Fixes the
-- `auth_rls_initplan` advisor warnings on the 6 affected tables.
-- All recreated policies keep their original `TO authenticated` role target.

-- profiles -------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_select_own_or_org ON public.profiles;
CREATE POLICY profiles_select_own_or_org ON public.profiles
  FOR SELECT TO authenticated
  USING (
    (id = (SELECT auth.uid()))
    OR private.is_super_admin()
    OR (
      organization_id IS NOT NULL
      AND organization_id = private.user_org_id()
    )
  );

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING ((id = (SELECT auth.uid())) OR private.is_super_admin());

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK ((id = (SELECT auth.uid())) OR private.is_super_admin());

-- companies ------------------------------------------------------------------
DROP POLICY IF EXISTS companies_insert ON public.companies;
CREATE POLICY companies_insert ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK (
    private.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.company_members cm
      JOIN public.companies c ON c.id = cm.company_id
      WHERE cm.user_id = (SELECT auth.uid())
        AND cm.is_active = true
        AND cm.role = ANY (ARRAY['org_admin'::app_role, 'company_admin'::app_role])
        AND c.organization_id = companies.organization_id
    )
  );

-- company_members ------------------------------------------------------------
DROP POLICY IF EXISTS company_members_select ON public.company_members;
CREATE POLICY company_members_select ON public.company_members
  FOR SELECT TO authenticated
  USING (
    private.is_super_admin()
    OR (user_id = (SELECT auth.uid()))
    OR private.has_company_access(company_id)
  );

DROP POLICY IF EXISTS company_members_insert ON public.company_members;
CREATE POLICY company_members_insert ON public.company_members
  FOR INSERT TO authenticated
  WITH CHECK (
    private.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.company_members cm
      WHERE cm.user_id = (SELECT auth.uid())
        AND cm.company_id = company_members.company_id
        AND cm.is_active = true
        AND cm.role = ANY (ARRAY['org_admin'::app_role, 'company_admin'::app_role])
    )
  );

DROP POLICY IF EXISTS company_members_update ON public.company_members;
CREATE POLICY company_members_update ON public.company_members
  FOR UPDATE TO authenticated
  USING (
    private.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.company_members cm
      WHERE cm.user_id = (SELECT auth.uid())
        AND cm.company_id = company_members.company_id
        AND cm.is_active = true
        AND cm.role = ANY (ARRAY['org_admin'::app_role, 'company_admin'::app_role])
    )
  );

-- salesman_routes ------------------------------------------------------------
DROP POLICY IF EXISTS salesman_routes_select ON public.salesman_routes;
CREATE POLICY salesman_routes_select ON public.salesman_routes
  FOR SELECT TO authenticated
  USING (
    private.has_company_access(company_id)
    OR (user_id = (SELECT auth.uid()))
  );

-- sync_sessions --------------------------------------------------------------
DROP POLICY IF EXISTS sync_sessions_select ON public.sync_sessions;
CREATE POLICY sync_sessions_select ON public.sync_sessions
  FOR SELECT TO authenticated
  USING (
    private.has_company_access(company_id)
    OR (user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS sync_sessions_update ON public.sync_sessions;
CREATE POLICY sync_sessions_update ON public.sync_sessions
  FOR UPDATE TO authenticated
  USING (
    private.has_company_access(company_id)
    OR (user_id = (SELECT auth.uid()))
  );

-- notifications --------------------------------------------------------------
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT TO authenticated
  USING (
    private.has_company_access(company_id)
    AND (
      (user_id IS NULL)
      OR (user_id = (SELECT auth.uid()))
      OR private.is_super_admin()
    )
  );

DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE TO authenticated
  USING ((user_id = (SELECT auth.uid())) OR private.is_super_admin());
