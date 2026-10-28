-- Shop account code on cash-book lines.

drop function if exists public.get_cash_desk(uuid, date, date);
drop function if exists public.get_cash_on_hand(uuid, date);
drop function if exists private.cash_on_hand_unchecked(uuid, date);
drop function if exists private.cash_events(uuid, date);
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
    coalesce(nullif(btrim(v.narration), ''), v.voucher_no, 'Cash payment'),
    v.id,
    null::uuid,
    null::uuid,
    null::text,
    null::text
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

grant execute on function public.get_cash_on_hand(uuid, date) to authenticated, service_role;
grant execute on function public.get_cash_desk(uuid, date, date) to authenticated, service_role;
