-- Service role only. Used when an admin creates a salesman login for an email
-- that already has an auth user, without exposing the lookup to the app.

create or replace function public.lookup_auth_user_id(p_email text)
returns uuid
language sql
security definer
set search_path = auth, public
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

revoke all on function public.lookup_auth_user_id(text) from public;
revoke all on function public.lookup_auth_user_id(text) from anon, authenticated;
grant execute on function public.lookup_auth_user_id(text) to service_role;
