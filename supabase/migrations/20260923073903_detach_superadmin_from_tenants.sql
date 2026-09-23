-- Platform superadmins must not be tenant users.
-- Detach every is_super_admin profile from company memberships and clear
-- their active company so login never lands on a distributor dashboard.

delete from public.company_members cm
using public.profiles p
where cm.user_id = p.id
  and p.is_super_admin = true;

update public.profiles
set
  active_company_id = null,
  organization_id = null
where is_super_admin = true;

-- Keep platform accounts out of tenant membership going forward.
create or replace function private.block_superadmin_company_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.profiles p
    where p.id = new.user_id
      and p.is_super_admin = true
  ) then
    raise exception 'Platform superadmin accounts cannot join companies';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_block_superadmin_company_membership on public.company_members;
create trigger trg_block_superadmin_company_membership
  before insert or update of user_id on public.company_members
  for each row
  execute function private.block_superadmin_company_membership();
