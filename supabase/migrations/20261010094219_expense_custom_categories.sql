-- Custom expense categories per company.
-- Moves expenses.category from enum to text and stores labels in expense_categories.

create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  label text not null,
  party_code text not null,
  is_system boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_categories_code_format
    check (code ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint expense_categories_label_len
    check (char_length(trim(label)) between 1 and 80),
  constraint expense_categories_party_code_len
    check (char_length(trim(party_code)) between 1 and 32),
  unique (company_id, code),
  unique (company_id, party_code)
);

create index if not exists expense_categories_company_active_idx
  on public.expense_categories (company_id, is_active, sort_order, label);

alter table public.expense_categories enable row level security;

drop policy if exists expense_categories_select on public.expense_categories;
create policy expense_categories_select
  on public.expense_categories for select
  using (private.has_company_access(company_id));

drop policy if exists expense_categories_insert on public.expense_categories;
create policy expense_categories_insert
  on public.expense_categories for insert
  with check (private.can_write_company(company_id));

drop policy if exists expense_categories_update on public.expense_categories;
create policy expense_categories_update
  on public.expense_categories for update
  using (private.can_write_company(company_id))
  with check (private.can_write_company(company_id));

drop policy if exists expense_categories_delete on public.expense_categories;
create policy expense_categories_delete
  on public.expense_categories for delete
  using (private.can_write_company(company_id) and is_system = false);

grant select, insert, update, delete on public.expense_categories to authenticated;
grant all on public.expense_categories to service_role;

-- Drop enum-dependent functions before converting the type.
drop function if exists public.create_expenses(jsonb);
drop function if exists private.ensure_expense_head(uuid, uuid, public.expense_category);

-- Convert expenses.category enum -> text (keep existing values).
alter table public.expenses
  alter column category type text using category::text;

alter table public.expenses
  drop constraint if exists expenses_category_nonempty;
alter table public.expenses
  add constraint expenses_category_nonempty
  check (char_length(trim(category)) > 0);

-- Drop enum only after dependents are gone.
drop type if exists public.expense_category;

-- Seed system categories for every company.
create or replace function private.seed_expense_categories(
  p_org_id uuid,
  p_company_id uuid
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.expense_categories (
    organization_id, company_id, code, label, party_code,
    is_system, is_active, sort_order
  )
  values
    (p_org_id, p_company_id, 'salary', 'Salesman salary', 'EXP-SAL', true, true, 10),
    (p_org_id, p_company_id, 'builty', 'Builty expense', 'EXP-BUILTY', true, true, 20),
    (p_org_id, p_company_id, 'fuel', 'Fuel / petrol', 'EXP-FUEL', true, true, 30),
    (p_org_id, p_company_id, 'food', 'Daily food', 'EXP-FOOD', true, true, 40),
    (p_org_id, p_company_id, 'rent', 'Rent', 'EXP-RENT', true, true, 50),
    (p_org_id, p_company_id, 'utilities', 'Utilities (bill)', 'EXP-UTIL', true, true, 60),
    (p_org_id, p_company_id, 'conveyance', 'Conveyance / travel', 'EXP-CONV', true, true, 70),
    (p_org_id, p_company_id, 'loading', 'Loading / labour', 'EXP-LOAD', true, true, 80),
    (p_org_id, p_company_id, 'stationery', 'Stationery / office', 'EXP-STAT', true, true, 90),
    (p_org_id, p_company_id, 'other', 'Other', 'EXP-OTH', true, true, 100)
  on conflict (company_id, code) do nothing;
end;
$$;

insert into public.expense_categories (
  organization_id, company_id, code, label, party_code,
  is_system, is_active, sort_order
)
select
  c.organization_id,
  c.id,
  s.code,
  s.label,
  s.party_code,
  true,
  true,
  s.sort_order
from public.companies c
cross join (
  values
    ('salary', 'Salesman salary', 'EXP-SAL', 10),
    ('builty', 'Builty expense', 'EXP-BUILTY', 20),
    ('fuel', 'Fuel / petrol', 'EXP-FUEL', 30),
    ('food', 'Daily food', 'EXP-FOOD', 40),
    ('rent', 'Rent', 'EXP-RENT', 50),
    ('utilities', 'Utilities (bill)', 'EXP-UTIL', 60),
    ('conveyance', 'Conveyance / travel', 'EXP-CONV', 70),
    ('loading', 'Loading / labour', 'EXP-LOAD', 80),
    ('stationery', 'Stationery / office', 'EXP-STAT', 90),
    ('other', 'Other', 'EXP-OTH', 100)
) as s(code, label, party_code, sort_order)
on conflict (company_id, code) do nothing;

create or replace function private.ensure_expense_head(
  p_org_id uuid,
  p_company_id uuid,
  p_category text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_code text;
  v_name text;
  v_id uuid;
  v_cat_code text := lower(trim(coalesce(p_category, '')));
begin
  if v_cat_code = '' then
    raise exception 'Choose an expense type for every line';
  end if;

  perform private.seed_expense_categories(p_org_id, p_company_id);

  select party_code, label
    into v_code, v_name
  from public.expense_categories
  where company_id = p_company_id
    and code = v_cat_code
    and is_active = true
  limit 1;

  if v_code is null then
    raise exception 'Unknown expense type: %', p_category;
  end if;

  select id into v_id
  from public.parties
  where company_id = p_company_id
    and party_code = v_code
  limit 1;

  if v_id is null then
    insert into public.parties (
      organization_id, company_id, party_code, name_en,
      party_type, party_subtype, head, sub_head, created_by
    ) values (
      p_org_id, p_company_id, v_code, v_name,
      'EXPENSES', 'other', 'Expenses', v_name, auth.uid()
    )
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

create or replace function public.create_expenses(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_date date := coalesce((p_payload->>'expense_date')::date, current_date);
  v_line jsonb;
  v_category text;
  v_amount numeric;
  v_salesman uuid;
  v_warehouse uuid;
  v_vendor uuid;
  v_remarks text;
  v_party uuid;
  v_no text;
  v_id uuid;
  v_sm_name text;
  v_wh_name text;
  v_vendor_name text;
  v_label text;
  v_narration text;
  v_ids uuid[] := '{}';
  v_count int := 0;
begin
  if not private.can_write_company(v_company_id) then
    raise exception 'No write access';
  end if;
  if v_org_id is null or v_company_id is null then
    raise exception 'Company is required';
  end if;

  perform private.seed_expense_categories(v_org_id, v_company_id);

  for v_line in select * from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  loop
    v_category := lower(trim(coalesce(v_line->>'category', '')));
    v_amount := coalesce((v_line->>'amount')::numeric, 0);
    v_salesman := nullif(v_line->>'salesman_id', '')::uuid;
    v_warehouse := nullif(v_line->>'warehouse_id', '')::uuid;
    v_vendor := nullif(v_line->>'vendor_id', '')::uuid;
    v_remarks := nullif(trim(coalesce(v_line->>'remarks', '')), '');

    if v_amount <= 0 then
      continue;
    end if;
    if v_category = '' then
      raise exception 'Choose an expense type for every line';
    end if;

    select label into v_label
    from public.expense_categories
    where company_id = v_company_id
      and code = v_category
      and is_active = true
    limit 1;

    if v_label is null then
      raise exception 'Unknown expense type: %', v_category;
    end if;

    if v_category = 'salary' and v_salesman is null then
      raise exception 'Select the salesman for salary';
    end if;
    if v_category = 'builty' then
      if v_warehouse is null then
        raise exception 'Select the company for builty expense';
      end if;
      if v_vendor is null then
        raise exception 'Select the vendor for builty expense';
      end if;
    end if;
    if v_salesman is not null then
      if not exists (
        select 1 from public.salesmen
        where id = v_salesman and company_id = v_company_id
      ) then
        raise exception 'Unknown salesman';
      end if;
    end if;
    if v_warehouse is not null then
      if not exists (
        select 1 from public.warehouses
        where id = v_warehouse and company_id = v_company_id
      ) then
        raise exception 'Unknown company';
      end if;
    end if;
    if v_vendor is not null then
      if not exists (
        select 1 from public.parties
        where id = v_vendor
          and company_id = v_company_id
          and (
            party_subtype in ('supplier', 'both')
            or party_type = 'PARTY'
          )
      ) then
        raise exception 'Unknown vendor';
      end if;
    end if;

    if v_category <> 'salary' then
      v_salesman := null;
    end if;
    if v_category <> 'builty' then
      v_warehouse := null;
      v_vendor := null;
    end if;

    v_party := private.ensure_expense_head(v_org_id, v_company_id, v_category);
    v_no := public.next_document_no(v_company_id, 'expense', 'EXP-');

    insert into public.expenses (
      organization_id, company_id, expense_no, expense_date,
      category, amount, salesman_id, warehouse_id, vendor_id,
      party_id, remarks, created_by
    ) values (
      v_org_id, v_company_id, v_no, v_date,
      v_category, v_amount, v_salesman, v_warehouse, v_vendor,
      v_party, v_remarks, auth.uid()
    )
    returning id into v_id;

    select full_name into v_sm_name
    from public.salesmen
    where id = v_salesman;

    select name into v_wh_name
    from public.warehouses
    where id = v_warehouse;

    select coalesce(nullif(trim(party_code), '') || ' — ', '') || name_en
      into v_vendor_name
    from public.parties
    where id = v_vendor;

    v_narration := v_label || ' ' || v_no;
    if v_sm_name is not null then
      v_narration := v_narration || ' — ' || v_sm_name;
    end if;
    if v_wh_name is not null then
      v_narration := v_narration || ' — ' || v_wh_name;
    end if;
    if v_vendor_name is not null then
      v_narration := v_narration || ' — ' || v_vendor_name;
    end if;
    if v_remarks is not null then
      v_narration := v_narration || ' — ' || v_remarks;
    end if;

    perform private.post_ledger(
      v_org_id, v_company_id, v_party, v_date,
      v_amount, 0, v_narration, 'expenses', v_id, 'EX'
    );

    v_ids := array_append(v_ids, v_id);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'Add at least one expense with amount';
  end if;

  return jsonb_build_object('ids', to_jsonb(v_ids), 'count', v_count);
end;
$$;

grant execute on function public.create_expenses(jsonb) to authenticated, service_role;

-- Create a custom expense category for a company.
create or replace function public.create_expense_category(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_label text := trim(coalesce(p_payload->>'label', ''));
  v_base text;
  v_code text;
  v_party text;
  v_n int := 0;
  v_id uuid;
  v_row public.expense_categories%rowtype;
begin
  if not private.can_write_company(v_company_id) then
    raise exception 'No write access';
  end if;
  if v_org_id is null or v_company_id is null then
    raise exception 'Company is required';
  end if;
  if char_length(v_label) < 2 then
    raise exception 'Enter a category name (at least 2 characters)';
  end if;
  if char_length(v_label) > 80 then
    raise exception 'Category name is too long';
  end if;

  if not exists (
    select 1 from public.companies
    where id = v_company_id and organization_id = v_org_id
  ) then
    raise exception 'Company not found';
  end if;

  perform private.seed_expense_categories(v_org_id, v_company_id);

  -- Reuse existing active category with same label (case-insensitive).
  select * into v_row
  from public.expense_categories
  where company_id = v_company_id
    and lower(label) = lower(v_label)
    and is_active = true
  limit 1;

  if found then
    return jsonb_build_object(
      'id', v_row.id,
      'code', v_row.code,
      'label', v_row.label,
      'is_system', v_row.is_system,
      'reused', true
    );
  end if;

  v_base := lower(regexp_replace(v_label, '[^a-zA-Z0-9]+', '_', 'g'));
  v_base := trim(both '_' from v_base);
  if v_base = '' or v_base !~ '^[a-z]' then
    v_base := 'exp_' || v_base;
  end if;
  if v_base = 'exp_' or v_base = '' then
    v_base := 'custom';
  end if;
  v_base := left(v_base, 32);

  v_code := v_base;
  while exists (
    select 1 from public.expense_categories
    where company_id = v_company_id and code = v_code
  ) loop
    v_n := v_n + 1;
    v_code := left(v_base, 28) || '_' || v_n::text;
  end loop;

  v_n := 0;
  v_party := 'EXP-' || upper(left(regexp_replace(v_code, '[^a-z0-9]+', '', 'g'), 12));
  if char_length(v_party) < 5 then
    v_party := 'EXP-CUSTOM';
  end if;
  while exists (
    select 1 from public.expense_categories
    where company_id = v_company_id and party_code = v_party
  ) loop
    v_n := v_n + 1;
    v_party := left('EXP-' || upper(left(regexp_replace(v_code, '[^a-z0-9]+', '', 'g'), 8)), 28)
      || v_n::text;
  end loop;

  insert into public.expense_categories (
    organization_id, company_id, code, label, party_code,
    is_system, is_active, sort_order, created_by
  ) values (
    v_org_id, v_company_id, v_code, v_label, v_party,
    false, true, 200, auth.uid()
  )
  returning id into v_id;

  -- Ensure ledger head exists immediately.
  perform private.ensure_expense_head(v_org_id, v_company_id, v_code);

  select * into v_row from public.expense_categories where id = v_id;

  return jsonb_build_object(
    'id', v_row.id,
    'code', v_row.code,
    'label', v_row.label,
    'is_system', v_row.is_system,
    'reused', false
  );
end;
$$;

grant execute on function public.create_expense_category(jsonb) to authenticated, service_role;

-- List categories (seeds defaults first).
create or replace function public.list_expense_categories(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org_id uuid;
begin
  if not private.has_company_access(p_company_id) then
    raise exception 'No access';
  end if;

  select organization_id into v_org_id
  from public.companies
  where id = p_company_id;

  if v_org_id is null then
    raise exception 'Company not found';
  end if;

  perform private.seed_expense_categories(v_org_id, p_company_id);

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', ec.id,
        'code', ec.code,
        'label', ec.label,
        'is_system', ec.is_system,
        'sort_order', ec.sort_order
      )
      order by ec.sort_order, ec.label
    )
    from public.expense_categories ec
    where ec.company_id = p_company_id
      and ec.is_active = true
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.list_expense_categories(uuid) to authenticated, service_role;
