-- Daily expenses + salesman salary.
-- Each line posts to the matching EXPENSES chart-of-accounts head
-- (created automatically) so party ledger / cash position stay in sync.

create type public.expense_category as enum (
  'salary',
  'fuel',
  'food',
  'rent',
  'utilities',
  'conveyance',
  'loading',
  'stationery',
  'other'
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  expense_no text not null,
  expense_date date not null default current_date,
  category public.expense_category not null,
  amount numeric not null check (amount > 0),
  salesman_id uuid references public.salesmen(id) on delete set null,
  party_id uuid not null references public.parties(id),
  remarks text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, expense_no)
);

create index if not exists expenses_company_date_idx
  on public.expenses (company_id, expense_date desc, created_at desc);
create index if not exists expenses_company_salesman_idx
  on public.expenses (company_id, salesman_id);
create index if not exists expenses_company_category_idx
  on public.expenses (company_id, category);

-- Chart-of-accounts head per category (one per company).
create or replace function private.ensure_expense_head(
  p_org_id uuid,
  p_company_id uuid,
  p_category public.expense_category
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_code text;
  v_name text;
  v_id uuid;
begin
  v_code := case p_category
    when 'salary' then 'EXP-SAL'
    when 'fuel' then 'EXP-FUEL'
    when 'food' then 'EXP-FOOD'
    when 'rent' then 'EXP-RENT'
    when 'utilities' then 'EXP-UTIL'
    when 'conveyance' then 'EXP-CONV'
    when 'loading' then 'EXP-LOAD'
    when 'stationery' then 'EXP-STAT'
    else 'EXP-OTH'
  end;
  v_name := case p_category
    when 'salary' then 'Salesman Salary'
    when 'fuel' then 'Fuel / Petrol'
    when 'food' then 'Daily Food'
    when 'rent' then 'Rent'
    when 'utilities' then 'Utilities'
    when 'conveyance' then 'Conveyance / Travel'
    when 'loading' then 'Loading / Labour'
    when 'stationery' then 'Stationery / Office'
    else 'Other Expenses'
  end;

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
  v_category public.expense_category;
  v_amount numeric;
  v_salesman uuid;
  v_remarks text;
  v_party uuid;
  v_no text;
  v_id uuid;
  v_sm_name text;
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

  for v_line in select * from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  loop
    v_category := (v_line->>'category')::public.expense_category;
    v_amount := coalesce((v_line->>'amount')::numeric, 0);
    v_salesman := nullif(v_line->>'salesman_id', '')::uuid;
    v_remarks := nullif(trim(coalesce(v_line->>'remarks', '')), '');

    if v_amount <= 0 then
      continue;
    end if;
    if v_category is null then
      raise exception 'Choose an expense type for every line';
    end if;
    if v_category = 'salary' and v_salesman is null then
      raise exception 'Select the salesman for salary';
    end if;
    if v_salesman is not null then
      if not exists (
        select 1 from public.salesmen
        where id = v_salesman and company_id = v_company_id
      ) then
        raise exception 'Unknown salesman';
      end if;
    end if;

    v_party := private.ensure_expense_head(v_org_id, v_company_id, v_category);
    v_no := public.next_document_no(v_company_id, 'expense', 'EXP-');

    insert into public.expenses (
      organization_id, company_id, expense_no, expense_date,
      category, amount, salesman_id, party_id, remarks, created_by
    ) values (
      v_org_id, v_company_id, v_no, v_date,
      v_category, v_amount, v_salesman, v_party, v_remarks, auth.uid()
    )
    returning id into v_id;

    select full_name into v_sm_name
    from public.salesmen
    where id = v_salesman;

    v_label := case v_category
      when 'salary' then 'Salesman salary'
      when 'fuel' then 'Fuel / petrol'
      when 'food' then 'Daily food'
      when 'rent' then 'Rent'
      when 'utilities' then 'Utilities'
      when 'conveyance' then 'Conveyance'
      when 'loading' then 'Loading / labour'
      when 'stationery' then 'Stationery'
      else 'Other expense'
    end;

    v_narration := v_label || ' ' || v_no;
    if v_sm_name is not null then
      v_narration := v_narration || ' — ' || v_sm_name;
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

create or replace function public.delete_expense(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.expenses where id = p_id;
  if v_company is null then
    raise exception 'Expense not found';
  end if;
  if not private.can_write_company(v_company) then
    raise exception 'No write access';
  end if;

  delete from public.ledger_entries
  where ref_table = 'expenses' and ref_id = p_id;

  delete from public.expenses where id = p_id;
end;
$$;

create or replace function private.expenses_after_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from public.ledger_entries
  where company_id = old.company_id
    and ref_table = 'expenses'
    and ref_id = old.id;
  return old;
end;
$$;

drop trigger if exists expenses_after_delete on public.expenses;
create trigger expenses_after_delete
  after delete on public.expenses
  for each row execute function private.expenses_after_delete();

-- Seed expense heads so they appear in Chart of Accounts immediately.
insert into public.parties (
  organization_id, company_id, party_code, name_en,
  party_type, party_subtype, head, sub_head
)
select
  c.organization_id,
  c.id,
  x.code,
  x.name_en,
  'EXPENSES',
  'other',
  'Expenses',
  x.name_en
from public.companies c
cross join (
  values
    ('EXP-SAL', 'Salesman Salary'),
    ('EXP-FUEL', 'Fuel / Petrol'),
    ('EXP-FOOD', 'Daily Food'),
    ('EXP-RENT', 'Rent'),
    ('EXP-UTIL', 'Utilities'),
    ('EXP-CONV', 'Conveyance / Travel'),
    ('EXP-LOAD', 'Loading / Labour'),
    ('EXP-STAT', 'Stationery / Office'),
    ('EXP-OTH', 'Other Expenses')
) as x(code, name_en)
on conflict (company_id, party_code) do nothing;

alter table public.expenses enable row level security;

create policy expenses_select on public.expenses
  for select using (private.has_company_access(company_id));
create policy expenses_insert on public.expenses
  for insert with check (private.can_write_company(company_id));
create policy expenses_update on public.expenses
  for update using (private.can_write_company(company_id))
  with check (private.can_write_company(company_id));
create policy expenses_delete on public.expenses
  for delete using (private.can_write_company(company_id));

grant select, insert, update, delete on public.expenses to anon, authenticated, service_role;
grant execute on function public.create_expenses(jsonb) to authenticated, service_role;
grant execute on function public.delete_expense(uuid) to authenticated, service_role;
