-- Customer receivables / sector sheets follow Arrange shops order.
create or replace function public.get_recovery_sheet(
  p_company_id uuid,
  p_as_of date default current_date,
  p_city text default null,
  p_route text default null
)
returns table(
  party_id uuid,
  party_code text,
  name_en text,
  city text,
  route text,
  balance numeric,
  credit_limit numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    p.id,
    p.party_code,
    p.name_en,
    p.city,
    p.route,
    coalesce(p.opening_balance, 0) + coalesce(sum(le.debit - le.credit), 0) as balance,
    p.credit_limit
  from public.parties p
  left join public.ledger_entries le
    on le.company_id = p.company_id
   and le.party_id = p.id
   and le.entry_date <= p_as_of
  where p.company_id = p_company_id
    and p.is_active = true
    and p.party_subtype in ('customer', 'both')
    and (p_city is null or p.city = p_city)
    and (p_route is null or p.route = p_route)
    and private.has_company_access(p_company_id)
  group by
    p.id,
    p.party_code,
    p.name_en,
    p.city,
    p.route,
    p.opening_balance,
    p.credit_limit,
    p.sort_order
  order by p.sort_order, p.party_code;
$$;
