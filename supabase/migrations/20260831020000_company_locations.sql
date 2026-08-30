-- Reusable city / head / sector lists so dropdowns stay filled
-- even before a customer is saved with that value.

create type public.location_kind as enum ('city', 'head', 'sector');

create table if not exists public.company_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  kind public.location_kind not null,
  name text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (length(trim(name)) > 0)
);

create unique index if not exists company_locations_company_kind_name_idx
  on public.company_locations (company_id, kind, lower(trim(name)));

create index if not exists company_locations_company_kind_idx
  on public.company_locations (company_id, kind);

insert into public.company_locations (organization_id, company_id, kind, name)
select distinct c.organization_id, p.company_id, 'city'::public.location_kind, trim(p.city)
from public.parties p
join public.companies c on c.id = p.company_id
where coalesce(trim(p.city), '') <> ''
on conflict do nothing;

insert into public.company_locations (organization_id, company_id, kind, name)
select distinct c.organization_id, p.company_id, 'head'::public.location_kind, trim(p.head)
from public.parties p
join public.companies c on c.id = p.company_id
where coalesce(trim(p.head), '') <> ''
on conflict do nothing;

insert into public.company_locations (organization_id, company_id, kind, name)
select distinct c.organization_id, p.company_id, 'sector'::public.location_kind, trim(p.route)
from public.parties p
join public.companies c on c.id = p.company_id
where coalesce(trim(p.route), '') <> ''
on conflict do nothing;

alter table public.company_locations enable row level security;

create policy company_locations_select on public.company_locations
  for select using (private.has_company_access(company_id));
create policy company_locations_insert on public.company_locations
  for insert with check (private.can_write_company(company_id));
create policy company_locations_update on public.company_locations
  for update using (private.can_write_company(company_id))
  with check (private.can_write_company(company_id));
create policy company_locations_delete on public.company_locations
  for delete using (private.can_write_company(company_id));

grant select, insert, update, delete on public.company_locations to anon, authenticated, service_role;
