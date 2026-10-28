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

