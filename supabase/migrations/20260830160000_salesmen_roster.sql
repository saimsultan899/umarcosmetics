-- Salesman directory for office tagging (no login required).
-- Existing salesman_id values (profile ids) are copied so current bills stay linked.

create table if not exists public.salesmen (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id),
  full_name text not null,
  phone text,
  code text,
  is_active boolean not null default true,
  user_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists salesmen_company_active_idx
  on public.salesmen (company_id, is_active);

-- Seed from invited salesman members (keep the same uuid as profile id).
insert into public.salesmen (
  id, organization_id, company_id, full_name, phone, is_active, user_id, created_at
)
select
  cm.user_id,
  c.organization_id,
  cm.company_id,
  coalesce(nullif(trim(p.full_name), ''), 'Salesman'),
  p.phone,
  coalesce(cm.is_active, true),
  cm.user_id,
  cm.created_at
from public.company_members cm
join public.companies c on c.id = cm.company_id
join public.profiles p on p.id = cm.user_id
where cm.role = 'salesman'
on conflict (id) do nothing;

-- Any leftover ids already stored on documents.
insert into public.salesmen (
  id, organization_id, company_id, full_name, phone, is_active, user_id
)
select distinct on (x.salesman_id)
  x.salesman_id,
  c.organization_id,
  x.company_id,
  coalesce(nullif(trim(p.full_name), ''), 'Salesman'),
  p.phone,
  true,
  case when p.id is null then null else x.salesman_id end
from (
  select salesman_id, company_id from public.sale_invoices where salesman_id is not null
  union
  select salesman_id, company_id from public.recoveries where salesman_id is not null
  union
  select salesman_id, company_id from public.load_sheets where salesman_id is not null
) x
join public.companies c on c.id = x.company_id
left join public.profiles p on p.id = x.salesman_id
where not exists (select 1 from public.salesmen s where s.id = x.salesman_id)
on conflict (id) do nothing;

alter table public.sale_invoices
  drop constraint if exists sale_invoices_salesman_id_fkey;
alter table public.sale_invoices
  add constraint sale_invoices_salesman_id_fkey
  foreign key (salesman_id) references public.salesmen(id) on delete set null;

alter table public.recoveries
  drop constraint if exists recoveries_salesman_id_fkey;
alter table public.recoveries
  add constraint recoveries_salesman_id_fkey
  foreign key (salesman_id) references public.salesmen(id) on delete set null;

alter table public.load_sheets
  drop constraint if exists load_sheets_salesman_id_fkey;
alter table public.load_sheets
  add constraint load_sheets_salesman_id_fkey
  foreign key (salesman_id) references public.salesmen(id) on delete set null;

alter table public.salesmen enable row level security;

create policy salesmen_select on public.salesmen
  for select using (private.has_company_access(company_id));
create policy salesmen_insert on public.salesmen
  for insert with check (private.can_write_company(company_id));
create policy salesmen_update on public.salesmen
  for update using (private.can_write_company(company_id))
  with check (private.can_write_company(company_id));
create policy salesmen_delete on public.salesmen
  for delete using (private.can_write_company(company_id));

grant select, insert, update, delete on public.salesmen to anon, authenticated, service_role;
