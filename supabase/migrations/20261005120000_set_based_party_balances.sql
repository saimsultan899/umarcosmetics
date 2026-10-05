-- Balance math used to call get_party_balance once per party.
-- Dashboard, recovery, and accounts then did that for every customer
-- (and again for payables). One grouped ledger read returns the same numbers.

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
    p.credit_limit
  order by p.city nulls last, p.route nulls last, p.party_code;
$$;

create or replace function public.get_dashboard_snapshot(
  p_company_id uuid,
  p_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_sales numeric;
  v_recoveries numeric;
  v_purchases numeric;
  v_receivable numeric;
  v_payable numeric;
  v_low_stock int;
  v_over_limit int;
begin
  if not private.has_company_access(p_company_id) then
    raise exception 'No access';
  end if;

  select coalesce(sum(grand_total), 0) into v_sales
  from public.sale_invoices
  where company_id = p_company_id
    and invoice_date = p_date
    and status = 'posted';

  select coalesce(sum(amount), 0) into v_recoveries
  from public.recoveries
  where company_id = p_company_id
    and recovery_date = p_date;

  select coalesce(sum(grand_total), 0) into v_purchases
  from public.purchase_invoices
  where company_id = p_company_id
    and invoice_date = p_date
    and status = 'posted';

  select
    coalesce(sum(greatest(balance, 0)) filter (
      where party_subtype in ('customer', 'both')
    ), 0),
    coalesce(sum(greatest(-balance, 0)) filter (
      where party_subtype in ('supplier', 'both')
    ), 0),
    count(*) filter (
      where credit_limit > 0 and balance > credit_limit
    )
  into v_receivable, v_payable, v_over_limit
  from (
    select
      p.party_subtype,
      p.credit_limit,
      coalesce(p.opening_balance, 0) + coalesce(sum(le.debit - le.credit), 0) as balance
    from public.parties p
    left join public.ledger_entries le
      on le.company_id = p.company_id
     and le.party_id = p.id
     and le.entry_date <= p_date
    where p.company_id = p_company_id
      and p.is_active
    group by p.id, p.party_subtype, p.credit_limit, p.opening_balance
  ) balances;

  select count(*) into v_low_stock
  from public.stock_balances sb
  join public.products pr on pr.id = sb.product_id
  where sb.company_id = p_company_id
    and pr.reorder_level > 0
    and sb.qty <= pr.reorder_level;

  return jsonb_build_object(
    'sales_today', v_sales,
    'recoveries_today', v_recoveries,
    'purchases_today', v_purchases,
    'receivable', v_receivable,
    'payable', v_payable,
    'low_stock_count', v_low_stock,
    'over_limit_count', v_over_limit
  );
end;
$$;
