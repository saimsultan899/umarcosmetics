-- Cash drawer. Reads sales, recoveries, expenses, and cash payments.
-- New rows are only opening cash, person loans, and company loans.
-- Ledgers and stock are not posted from here.

create table if not exists public.cash_lenders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  phone text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_lenders_name_not_blank check (char_length(btrim(name)) > 0)
);

create index if not exists cash_lenders_company_idx
  on public.cash_lenders (company_id, name);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  movement_date date not null default current_date,
  kind text not null,
  direction text not null,
  amount numeric not null,
  lender_id uuid references public.cash_lenders(id) on delete restrict,
  counterparty_company_id uuid references public.companies(id),
  pair_id uuid,
  remarks text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint cash_movements_kind_check check (
    kind in ('opening', 'person_borrow', 'person_repay', 'company_borrow', 'company_repay')
  ),
  constraint cash_movements_direction_check check (direction in ('in', 'out')),
  constraint cash_movements_amount_check check (amount > 0)
);

create unique index if not exists cash_movements_one_opening_idx
  on public.cash_movements (company_id)
  where kind = 'opening';

create index if not exists cash_movements_company_date_idx
  on public.cash_movements (company_id, movement_date desc, created_at desc);

create index if not exists cash_movements_pair_idx
  on public.cash_movements (pair_id)
  where pair_id is not null;

create index if not exists cash_movements_lender_idx
  on public.cash_movements (lender_id)
  where lender_id is not null;

alter table public.cash_lenders enable row level security;
alter table public.cash_movements enable row level security;

drop policy if exists cash_lenders_select on public.cash_lenders;
create policy cash_lenders_select on public.cash_lenders
  for select using (private.has_company_access(company_id));

drop policy if exists cash_movements_select on public.cash_movements;
create policy cash_movements_select on public.cash_movements
  for select using (private.has_company_access(company_id));

grant select on public.cash_lenders to authenticated, service_role;
grant select on public.cash_movements to authenticated, service_role;

-- Every note that entered or left the drawer on or before a date.
create or replace function private.cash_events(
  p_company_id uuid,
  p_as_of date
)
returns table (
  line_date date,
  sort_at timestamptz,
  source text,
  direction text,
  amount numeric,
  title text,
  ref_id uuid,
  movement_id uuid,
  pair_id uuid,
  sector text,
  code text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    s.invoice_date,
    s.created_at,
    'sale'::text,
    'in'::text,
    s.amount_paid,
    trim(both ' —' from concat_ws(' — ', nullif(s.invoice_no, ''), nullif(p.name_en, ''))),
    s.id,
    null::uuid,
    null::uuid,
    nullif(btrim(p.route), ''),
    nullif(btrim(p.party_code), '')
  from public.sale_invoices s
  left join public.parties p on p.id = s.party_id
  where s.company_id = p_company_id
    and s.status = 'posted'
    and coalesce(s.amount_paid, 0) > 0
    and s.invoice_date <= p_as_of

  union all

  select
    coalesce(r.recovery_date, (timezone('Asia/Karachi', r.created_at))::date),
    r.created_at,
    'recovery'::text,
    'in'::text,
    r.amount,
    coalesce(nullif(btrim(p.name_en), ''), 'Recovery'),
    coalesce(r.voucher_id, r.id),
    null::uuid,
    null::uuid,
    nullif(btrim(p.route), ''),
    nullif(btrim(p.party_code), '')
  from public.recoveries r
  left join public.parties p on p.id = r.party_id
  where r.company_id = p_company_id
    and coalesce(r.amount, 0) > 0
    and coalesce(r.recovery_date, (timezone('Asia/Karachi', r.created_at))::date) <= p_as_of

  union all

  select
    coalesce(v.voucher_date, (timezone('Asia/Karachi', v.created_at))::date),
    coalesce(v.created_at, v.voucher_date::timestamptz),
    'cash_receipt'::text,
    'in'::text,
    vl.amount,
    coalesce(nullif(btrim(p.name_en), ''), nullif(btrim(v.narration), ''), v.voucher_no, 'Cash receipt'),
    v.id,
    null::uuid,
    null::uuid,
    nullif(btrim(p.route), ''),
    nullif(btrim(p.party_code), '')
  from public.vouchers v
  join public.voucher_lines vl on vl.voucher_id = v.id
  left join public.parties p on p.id = vl.party_id
  where v.company_id = p_company_id
    and v.voucher_type = 'CR'
    and v.status = 'posted'
    and coalesce(vl.amount, 0) > 0
    and coalesce(v.voucher_date, (timezone('Asia/Karachi', v.created_at))::date) <= p_as_of
    and not exists (
      select 1
      from public.recoveries r
      where r.voucher_id = v.id
        and r.party_id = vl.party_id
        and abs(coalesce(r.amount, 0) - coalesce(vl.amount, 0)) < 0.01
    )

  union all

  select
    e.expense_date,
    e.created_at,
    'expense'::text,
    'out'::text,
    e.amount,
    btrim(concat_ws(' — ', initcap(replace(e.category::text, '_', ' ')), nullif(btrim(e.remarks), ''))),
    e.id,
    null::uuid,
    null::uuid,
    null::text,
    null::text
  from public.expenses e
  where e.company_id = p_company_id
    and coalesce(e.amount, 0) > 0
    and e.expense_date <= p_as_of

  union all

  select
    coalesce(v.voucher_date, (timezone('Asia/Karachi', v.created_at))::date),
    coalesce(v.created_at, v.voucher_date::timestamptz),
    'cash_payment'::text,
    'out'::text,
    coalesce(
      nullif(v.total_amount, 0),
      (select coalesce(sum(vl.amount), 0) from public.voucher_lines vl where vl.voucher_id = v.id)
    ),
    coalesce(
      (
        select nullif(btrim(p.name_en), '')
        from public.voucher_lines vl
        join public.parties p on p.id = vl.party_id
        where vl.voucher_id = v.id
        limit 1
      ),
      nullif(btrim(v.narration), ''),
      v.voucher_no,
      'Cash payment'
    ),
    v.id,
    null::uuid,
    null::uuid,
    null::text,
    (
      select nullif(btrim(p.party_code), '')
      from public.voucher_lines vl
      join public.parties p on p.id = vl.party_id
      where vl.voucher_id = v.id
      limit 1
    )
  from public.vouchers v
  where v.company_id = p_company_id
    and v.voucher_type = 'CP'
    and v.status = 'posted'
    and v.payment_method = 'cash'
    and coalesce(v.voucher_date, (timezone('Asia/Karachi', v.created_at))::date) <= p_as_of
    and coalesce(
      nullif(v.total_amount, 0),
      (select coalesce(sum(vl.amount), 0) from public.voucher_lines vl where vl.voucher_id = v.id)
    ) > 0

  union all

  select
    m.movement_date,
    m.created_at,
    m.kind,
    m.direction,
    m.amount,
    case m.kind
      when 'opening' then 'Opening cash'
      when 'person_borrow' then 'Borrowed from ' || coalesce(l.name, 'a person')
      when 'person_repay' then 'Returned to ' || coalesce(l.name, 'a person')
      when 'company_borrow' then
        case when m.direction = 'in'
          then 'Borrowed from ' || coalesce(c.name, 'a company')
          else 'Lent to ' || coalesce(c.name, 'a company')
        end
      else
        case when m.direction = 'out'
          then 'Returned to ' || coalesce(c.name, 'a company')
          else 'Received back from ' || coalesce(c.name, 'a company')
        end
    end,
    m.id,
    m.id,
    m.pair_id,
    null::text,
    null::text
  from public.cash_movements m
  left join public.cash_lenders l on l.id = m.lender_id
  left join public.companies c on c.id = m.counterparty_company_id
  where m.company_id = p_company_id
    and m.movement_date <= p_as_of;
$$;

create or replace function public.get_cash_on_hand(
  p_company_id uuid,
  p_as_of date default current_date
)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_total numeric;
begin
  if not (private.has_company_access(p_company_id) or private.is_super_admin()) then
    raise exception 'No access';
  end if;
  select coalesce(sum(case when direction = 'in' then amount else -amount end), 0)
    into v_total
  from private.cash_events(p_company_id, coalesce(p_as_of, current_date));
  return v_total;
end;
$$;

create or replace function private.cash_on_hand_unchecked(
  p_company_id uuid,
  p_as_of date
)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(sum(case when direction = 'in' then amount else -amount end), 0)
  from private.cash_events(p_company_id, coalesce(p_as_of, current_date));
$$;

create or replace function public.get_cash_desk(
  p_company_id uuid,
  p_as_of date default current_date,
  p_from date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_as_of date := coalesce(p_as_of, current_date);
  v_from date := coalesce(p_from, v_as_of);
  v_org uuid;
  v_main uuid;
  v_on_hand numeric;
  v_brought numeric;
  v_lines jsonb;
  v_lenders jsonb;
  v_sisters jsonb;
begin
  if v_from > v_as_of then
    v_from := v_as_of;
  end if;
  if not (private.has_company_access(p_company_id) or private.is_super_admin()) then
    raise exception 'No access';
  end if;

  select c.organization_id, o.main_company_id
    into v_org, v_main
  from public.companies c
  join public.organizations o on o.id = c.organization_id
  where c.id = p_company_id;

  select coalesce(sum(case when direction = 'in' then amount else -amount end), 0)
    into v_on_hand
  from private.cash_events(p_company_id, v_as_of);

  select coalesce(sum(case when direction = 'in' then amount else -amount end), 0)
    into v_brought
  from private.cash_events(p_company_id, v_as_of) e
  where e.line_date < v_from;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.line_date, x.sort_at nulls last), '[]'::jsonb)
    into v_lines
  from (
    select line_date, sort_at, source, direction, amount, title, ref_id, movement_id, pair_id, sector, code
    from private.cash_events(p_company_id, v_as_of) e
    where e.line_date >= v_from
  ) x;

  select coalesce(jsonb_agg(row_to_json(l)::jsonb order by l.name), '[]'::jsonb)
    into v_lenders
  from (
    select
      cl.id,
      cl.name,
      cl.phone,
      cl.is_active,
      coalesce(sum(
        case
          when m.kind = 'person_borrow' then m.amount
          when m.kind = 'person_repay' then -m.amount
          else 0
        end
      ), 0) as outstanding
    from public.cash_lenders cl
    left join public.cash_movements m
      on m.lender_id = cl.id
     and m.movement_date <= v_as_of
    where cl.company_id = p_company_id
    group by cl.id, cl.name, cl.phone, cl.is_active
    having cl.is_active
        or abs(coalesce(sum(
             case
               when m.kind = 'person_borrow' then m.amount
               when m.kind = 'person_repay' then -m.amount
               else 0
             end
           ), 0)) > 0.005
  ) l;

  if v_main is null or v_main = p_company_id then
    select coalesce(jsonb_agg(row_to_json(s)::jsonb order by s.name), '[]'::jsonb)
      into v_sisters
    from (
      select
        c.id,
        c.name,
        private.cash_on_hand_unchecked(c.id, v_as_of) as on_hand,
        coalesce((
          select sum(
            case
              when m.kind = 'company_borrow' and m.direction = 'in' then m.amount
              when m.kind = 'company_repay' and m.direction = 'out' then -m.amount
              else 0
            end
          )
          from public.cash_movements m
          where m.company_id = p_company_id
            and m.counterparty_company_id = c.id
            and m.movement_date <= v_as_of
        ), 0) as borrowed
      from public.companies c
      where c.organization_id = v_org
        and c.id <> p_company_id
        and c.is_active
    ) s;
  else
    v_sisters := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'on_hand', v_on_hand,
    'brought_forward', v_brought,
    'as_of', v_as_of,
    'from', v_from,
    'is_hub', v_main is null or v_main = p_company_id,
    'lines', v_lines,
    'lenders', v_lenders,
    'sisters', v_sisters
  );
end;
$$;

create or replace function public.save_cash_opening(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company uuid := (p_payload->>'company_id')::uuid;
  v_org uuid;
  v_amount numeric := coalesce((p_payload->>'amount')::numeric, 0);
  v_date date := coalesce((p_payload->>'movement_date')::date, current_date);
  v_id uuid;
begin
  if v_company is null or not private.can_write_company(v_company) then
    raise exception 'No write access';
  end if;
  select organization_id into v_org from public.companies where id = v_company;
  if v_amount <= 0 then
    delete from public.cash_movements
    where company_id = v_company and kind = 'opening';
    return null;
  end if;
  select id into v_id
  from public.cash_movements
  where company_id = v_company and kind = 'opening';
  if v_id is null then
    insert into public.cash_movements (
      organization_id, company_id, movement_date, kind, direction, amount, remarks, created_by
    ) values (
      v_org, v_company, v_date, 'opening', 'in', v_amount,
      nullif(btrim(p_payload->>'remarks'), ''), auth.uid()
    )
    returning id into v_id;
  else
    update public.cash_movements
    set amount = v_amount,
        movement_date = v_date,
        remarks = nullif(btrim(p_payload->>'remarks'), '')
    where id = v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.save_cash_lender(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company uuid := (p_payload->>'company_id')::uuid;
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_org uuid;
  v_name text := btrim(coalesce(p_payload->>'name', ''));
begin
  if v_company is null or not private.can_write_company(v_company) then
    raise exception 'No write access';
  end if;
  if v_name = '' then
    raise exception 'Enter the person''s name';
  end if;
  select organization_id into v_org from public.companies where id = v_company;
  if v_id is null then
    insert into public.cash_lenders (organization_id, company_id, name, phone, created_by)
    values (v_org, v_company, v_name, nullif(btrim(p_payload->>'phone'), ''), auth.uid())
    returning id into v_id;
  else
    update public.cash_lenders
    set name = v_name,
        phone = nullif(btrim(p_payload->>'phone'), ''),
        is_active = coalesce((p_payload->>'is_active')::boolean, is_active),
        updated_at = now()
    where id = v_id and company_id = v_company;
    if not found then
      raise exception 'No write access';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.save_person_cash(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lender uuid := (p_payload->>'lender_id')::uuid;
  v_kind text := p_payload->>'kind';
  v_amount numeric := coalesce((p_payload->>'amount')::numeric, 0);
  v_date date := coalesce((p_payload->>'movement_date')::date, current_date);
  v_company uuid;
  v_org uuid;
  v_owed numeric;
  v_id uuid;
begin
  select company_id, organization_id into v_company, v_org
  from public.cash_lenders
  where id = v_lender and is_active;
  if v_company is null or not private.can_write_company(v_company) then
    raise exception 'No write access';
  end if;
  if v_kind not in ('person_borrow', 'person_repay') then
    raise exception 'Choose borrow or return';
  end if;
  if v_amount <= 0 then
    raise exception 'Enter an amount';
  end if;
  if v_kind = 'person_repay' then
    select coalesce(sum(
      case
        when kind = 'person_borrow' then amount
        when kind = 'person_repay' then -amount
        else 0
      end
    ), 0)
      into v_owed
    from public.cash_movements
    where lender_id = v_lender;
    if v_amount > v_owed + 0.009 then
      raise exception 'Return is more than owed to this person';
    end if;
  end if;
  insert into public.cash_movements (
    organization_id, company_id, movement_date, kind, direction, amount,
    lender_id, remarks, created_by
  ) values (
    v_org, v_company, v_date, v_kind,
    case when v_kind = 'person_borrow' then 'in' else 'out' end,
    v_amount, v_lender, nullif(btrim(p_payload->>'remarks'), ''), auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_cash_movement(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid := (p_payload->>'id')::uuid;
  v_row public.cash_movements%rowtype;
  v_left numeric;
begin
  select * into v_row from public.cash_movements where id = v_id;
  if v_row.id is null or not private.can_write_company(v_row.company_id) then
    raise exception 'No write access';
  end if;
  if v_row.kind in ('company_borrow', 'company_repay') then
    raise exception 'A company loan is removed from both companies together';
  end if;
  if v_row.kind = 'person_borrow' then
    select coalesce(sum(
      case
        when kind = 'person_borrow' and id <> v_row.id then amount
        when kind = 'person_repay' then -amount
        else 0
      end
    ), 0)
      into v_left
    from public.cash_movements
    where lender_id = v_row.lender_id;
    if v_left < -0.009 then
      raise exception 'Return is more than owed to this person';
    end if;
  end if;
  delete from public.cash_movements where id = v_id;
  return v_id;
end;
$$;

create or replace function public.save_company_cash_loan(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hub uuid := (p_payload->>'company_id')::uuid;
  v_sister uuid := (p_payload->>'counterparty_company_id')::uuid;
  v_action text := p_payload->>'action';
  v_amount numeric := coalesce((p_payload->>'amount')::numeric, 0);
  v_date date := coalesce((p_payload->>'movement_date')::date, current_date);
  v_org uuid;
  v_sister_org uuid;
  v_main uuid;
  v_company_count int;
  v_pair uuid := gen_random_uuid();
  v_owed numeric;
  v_sister_cash numeric;
  v_remarks text := nullif(btrim(p_payload->>'remarks'), '');
begin
  if v_hub is null or v_sister is null or v_hub = v_sister then
    raise exception 'Choose another company';
  end if;
  if not private.can_write_company(v_hub) or not private.can_write_company(v_sister) then
    raise exception 'No write access';
  end if;
  select organization_id into v_org from public.companies where id = v_hub and is_active;
  select organization_id into v_sister_org from public.companies where id = v_sister and is_active;
  if v_org is null or v_sister_org is null or v_org <> v_sister_org then
    raise exception 'Choose another company';
  end if;
  select main_company_id into v_main from public.organizations where id = v_org;
  if v_main is not null and v_main is distinct from v_hub then
    raise exception 'Only the main company can borrow from another company';
  end if;
  select count(*) into v_company_count
  from public.companies
  where organization_id = v_org and is_active;
  if v_company_count < 2 then
    raise exception 'Only the main company can borrow from another company';
  end if;
  if v_action not in ('borrow', 'repay') then
    raise exception 'Choose borrow or return';
  end if;
  if v_amount <= 0 then
    raise exception 'Enter an amount';
  end if;
  if v_action = 'borrow' then
    v_sister_cash := private.cash_on_hand_unchecked(v_sister, current_date);
    if v_amount > v_sister_cash + 0.009 then
      raise exception 'That company does not have that much cash on hand';
    end if;
    insert into public.cash_movements (
      organization_id, company_id, movement_date, kind, direction, amount,
      counterparty_company_id, pair_id, remarks, created_by
    ) values
      (v_org, v_hub, v_date, 'company_borrow', 'in', v_amount, v_sister, v_pair, v_remarks, auth.uid()),
      (v_org, v_sister, v_date, 'company_borrow', 'out', v_amount, v_hub, v_pair, v_remarks, auth.uid());
  else
    select coalesce(sum(
      case
        when kind = 'company_borrow' and direction = 'in' then amount
        when kind = 'company_repay' and direction = 'out' then -amount
        else 0
      end
    ), 0)
      into v_owed
    from public.cash_movements
    where company_id = v_hub
      and counterparty_company_id = v_sister;
    if v_amount > v_owed + 0.009 then
      raise exception 'Return is more than owed to this company';
    end if;
    insert into public.cash_movements (
      organization_id, company_id, movement_date, kind, direction, amount,
      counterparty_company_id, pair_id, remarks, created_by
    ) values
      (v_org, v_hub, v_date, 'company_repay', 'out', v_amount, v_sister, v_pair, v_remarks, auth.uid()),
      (v_org, v_sister, v_date, 'company_repay', 'in', v_amount, v_hub, v_pair, v_remarks, auth.uid());
  end if;
  return v_pair;
end;
$$;

create or replace function public.delete_company_cash_loan(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pair uuid := (p_payload->>'pair_id')::uuid;
  v_company uuid;
begin
  if v_pair is null then
    raise exception 'No write access';
  end if;
  for v_company in
    select company_id from public.cash_movements where pair_id = v_pair
  loop
    if not private.can_write_company(v_company) then
      raise exception 'No write access';
    end if;
  end loop;
  if not exists (select 1 from public.cash_movements where pair_id = v_pair) then
    raise exception 'No write access';
  end if;
  delete from public.cash_movements where pair_id = v_pair;
  return v_pair;
end;
$$;

grant execute on function public.get_cash_on_hand(uuid, date) to authenticated, service_role;
grant execute on function public.get_cash_desk(uuid, date, date) to authenticated, service_role;
grant execute on function public.save_cash_opening(jsonb) to authenticated, service_role;
grant execute on function public.save_cash_lender(jsonb) to authenticated, service_role;
grant execute on function public.save_person_cash(jsonb) to authenticated, service_role;
grant execute on function public.delete_cash_movement(jsonb) to authenticated, service_role;
grant execute on function public.save_company_cash_loan(jsonb) to authenticated, service_role;
grant execute on function public.delete_company_cash_loan(jsonb) to authenticated, service_role;

create or replace function public.update_cash_movement(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid := (p_payload->>'id')::uuid;
  v_row public.cash_movements%rowtype;
  v_amount numeric := coalesce((p_payload->>'amount')::numeric, 0);
  v_date date := coalesce((p_payload->>'movement_date')::date, current_date);
  v_remarks text := nullif(btrim(p_payload->>'remarks'), '');
  v_left numeric;
  v_sister_cash numeric;
  v_hub uuid;
  v_sister uuid;
begin
  if v_amount <= 0 then
    raise exception 'Enter an amount';
  end if;
  select * into v_row from public.cash_movements where id = v_id;
  if v_row.id is null or not private.can_write_company(v_row.company_id) then
    raise exception 'No write access';
  end if;

  if v_row.kind in ('person_borrow', 'person_repay') then
    select coalesce(sum(
      case
        when id = v_row.id then
          case when v_row.kind = 'person_borrow' then v_amount else -v_amount end
        when kind = 'person_borrow' then amount
        when kind = 'person_repay' then -amount
        else 0
      end
    ), 0)
      into v_left
    from public.cash_movements
    where lender_id = v_row.lender_id;
    if v_left < -0.009 then
      raise exception 'Return is more than owed to this person';
    end if;
    update public.cash_movements
      set amount = v_amount, movement_date = v_date, remarks = v_remarks
      where id = v_row.id;
    return v_row.id;
  end if;

  if v_row.kind = 'opening' then
    update public.cash_movements
      set amount = v_amount, movement_date = v_date, remarks = v_remarks
      where id = v_row.id;
    return v_row.id;
  end if;

  if v_row.kind in ('company_borrow', 'company_repay') then
    if v_row.pair_id is null then
      raise exception 'No write access';
    end if;
    if exists (
      select 1 from public.cash_movements m
      where m.pair_id = v_row.pair_id
        and not private.can_write_company(m.company_id)
    ) then
      raise exception 'No write access';
    end if;

    select m.company_id, m.counterparty_company_id
      into v_hub, v_sister
    from public.cash_movements m
    where m.pair_id = v_row.pair_id
      and (
        (m.kind = 'company_borrow' and m.direction = 'in')
        or (m.kind = 'company_repay' and m.direction = 'out')
      )
    limit 1;

    if v_row.kind = 'company_borrow' then
      select private.cash_on_hand_unchecked(m.company_id, current_date) + m.amount
        into v_sister_cash
      from public.cash_movements m
      where m.pair_id = v_row.pair_id
        and m.direction = 'out';
      if v_amount > coalesce(v_sister_cash, 0) + 0.009 then
        raise exception 'That company does not have that much cash on hand';
      end if;
    end if;

    select coalesce(sum(
      case
        when m.pair_id = v_row.pair_id then
          case
            when m.kind = 'company_borrow' and m.direction = 'in' then v_amount
            when m.kind = 'company_repay' and m.direction = 'out' then -v_amount
            else 0
          end
        when m.kind = 'company_borrow' and m.direction = 'in' then m.amount
        when m.kind = 'company_repay' and m.direction = 'out' then -m.amount
        else 0
      end
    ), 0)
      into v_left
    from public.cash_movements m
    where m.company_id = v_hub
      and m.counterparty_company_id = v_sister;
    if v_left < -0.009 then
      raise exception 'Return is more than owed to this company';
    end if;

    update public.cash_movements
      set amount = v_amount, movement_date = v_date, remarks = v_remarks
      where pair_id = v_row.pair_id;
    return v_row.id;
  end if;

  raise exception 'No write access';
end;
$$;

grant execute on function public.update_cash_movement(jsonb) to authenticated, service_role;
