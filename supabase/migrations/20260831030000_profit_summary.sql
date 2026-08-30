-- Profit summary for a date range: net sales, estimated COGS, gross & net profit.

create or replace function public.get_profit_summary(
  p_company_id uuid,
  p_from date,
  p_to date
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_sales numeric := 0;
  v_returns numeric := 0;
  v_cogs numeric := 0;
  v_cogs_ret numeric := 0;
  v_expenses numeric := 0;
  v_salary numeric := 0;
  v_other_exp numeric := 0;
  v_net_sales numeric;
  v_cogs_net numeric;
  v_gross numeric;
  v_daily jsonb;
  v_exp_by_cat jsonb;
begin
  if not private.has_company_access(p_company_id) then
    raise exception 'No access to this company';
  end if;

  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Invalid date range';
  end if;

  select coalesce(sum(grand_total), 0) into v_sales
  from public.sale_invoices
  where company_id = p_company_id
    and status = 'posted'
    and invoice_date between p_from and p_to;

  select coalesce(sum(grand_total), 0) into v_returns
  from public.sale_returns
  where company_id = p_company_id
    and status = 'posted'
    and return_date between p_from and p_to;

  select coalesce(sum(
    (i.qty + coalesce(i.bonus_qty, 0)) * coalesce(p.purchase_rate, 0)
  ), 0)
  into v_cogs
  from public.sale_invoice_items i
  join public.sale_invoices s on s.id = i.sale_invoice_id
  join public.products p on p.id = i.product_id
  where s.company_id = p_company_id
    and s.status = 'posted'
    and s.invoice_date between p_from and p_to;

  select coalesce(sum(ri.qty * coalesce(p.purchase_rate, 0)), 0)
  into v_cogs_ret
  from public.sale_return_items ri
  join public.sale_returns r on r.id = ri.sale_return_id
  join public.products p on p.id = ri.product_id
  where r.company_id = p_company_id
    and r.status = 'posted'
    and r.return_date between p_from and p_to;

  select
    coalesce(sum(amount), 0),
    coalesce(sum(case when category = 'salary' then amount else 0 end), 0),
    coalesce(sum(case when category <> 'salary' then amount else 0 end), 0)
  into v_expenses, v_salary, v_other_exp
  from public.expenses
  where company_id = p_company_id
    and expense_date between p_from and p_to;

  v_net_sales := v_sales - v_returns;
  v_cogs_net := v_cogs - v_cogs_ret;
  v_gross := v_net_sales - v_cogs_net;

  select coalesce(jsonb_agg(row_to_json(t) order by t.day), '[]'::jsonb)
  into v_daily
  from (
    select
      d.day::date as day,
      coalesce(s.sales, 0) as sales,
      coalesce(r.returns, 0) as returns,
      coalesce(s.sales, 0) - coalesce(r.returns, 0) as net_sales,
      coalesce(e.expenses, 0) as expenses
    from generate_series(p_from, p_to, interval '1 day') as d(day)
    left join (
      select invoice_date as day, sum(grand_total) as sales
      from public.sale_invoices
      where company_id = p_company_id and status = 'posted'
        and invoice_date between p_from and p_to
      group by 1
    ) s on s.day = d.day::date
    left join (
      select return_date as day, sum(grand_total) as returns
      from public.sale_returns
      where company_id = p_company_id and status = 'posted'
        and return_date between p_from and p_to
      group by 1
    ) r on r.day = d.day::date
    left join (
      select expense_date as day, sum(amount) as expenses
      from public.expenses
      where company_id = p_company_id
        and expense_date between p_from and p_to
      group by 1
    ) e on e.day = d.day::date
  ) t;

  select coalesce(jsonb_agg(row_to_json(c) order by c.amount desc), '[]'::jsonb)
  into v_exp_by_cat
  from (
    select category::text as category, sum(amount) as amount
    from public.expenses
    where company_id = p_company_id
      and expense_date between p_from and p_to
    group by 1
  ) c;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'sales', v_sales,
    'returns', v_returns,
    'net_sales', v_net_sales,
    'cogs', v_cogs_net,
    'gross_profit', v_gross,
    'expenses', v_expenses,
    'salary', v_salary,
    'other_expenses', v_other_exp,
    'net_profit', v_gross - v_expenses,
    'gross_margin_pct', case when v_net_sales > 0 then round((v_gross / v_net_sales) * 100, 1) else 0 end,
    'net_margin_pct', case when v_net_sales > 0 then round(((v_gross - v_expenses) / v_net_sales) * 100, 1) else 0 end,
    'daily', v_daily,
    'expenses_by_category', v_exp_by_cat
  );
end;
$$;

revoke all on function public.get_profit_summary(uuid, date, date) from public;
grant execute on function public.get_profit_summary(uuid, date, date) to authenticated, service_role;
