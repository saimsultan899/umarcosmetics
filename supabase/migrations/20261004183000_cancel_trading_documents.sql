-- Cancel posted purchase invoices, sale returns, and purchase returns.
-- Reverses stock and party ledger the same way cancel_sale_invoice does for sales.

create or replace function public.cancel_purchase_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inv public.purchase_invoices%rowtype;
  v_item public.purchase_invoice_items%rowtype;
begin
  select * into v_inv from public.purchase_invoices where id = p_invoice_id;
  if not found then raise exception 'Purchase invoice not found'; end if;
  if not private.can_write_company(v_inv.company_id) then raise exception 'No write access'; end if;
  if v_inv.status <> 'posted' then raise exception 'This purchase invoice is already cancelled'; end if;

  if exists (
    select 1
    from public.purchase_returns r
    where r.purchase_invoice_id = v_inv.id
      and r.status = 'posted'
  ) then
    raise exception 'A purchase return is already posted against this invoice';
  end if;

  for v_item in
    select * from public.purchase_invoice_items where purchase_invoice_id = v_inv.id
  loop
    perform private.apply_stock_delta(
      v_inv.company_id,
      v_inv.warehouse_id,
      v_item.product_id,
      -abs(v_item.qty),
      'adjustment',
      'purchase_invoices',
      v_inv.id,
      true
    );
  end loop;

  -- Original purchase credited the supplier; reverse with a debit.
  perform private.post_ledger(
    v_inv.organization_id,
    v_inv.company_id,
    v_inv.party_id,
    v_inv.invoice_date,
    v_inv.grand_total,
    0,
    'Cancel purchase ' || v_inv.invoice_no,
    'purchase_invoices',
    v_inv.id,
    'PI'
  );

  update public.purchase_invoices
  set status = 'cancelled', updated_at = now()
  where id = v_inv.id;
end;
$function$;

create or replace function public.cancel_sale_return(p_return_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ret public.sale_returns%rowtype;
  v_item public.sale_return_items%rowtype;
begin
  select * into v_ret from public.sale_returns where id = p_return_id;
  if not found then raise exception 'Sale return not found'; end if;
  if not private.can_write_company(v_ret.company_id) then raise exception 'No write access'; end if;
  if v_ret.status <> 'posted' then raise exception 'This sale return is already cancelled'; end if;

  for v_item in
    select * from public.sale_return_items where sale_return_id = v_ret.id
  loop
    perform private.apply_stock_delta(
      v_ret.company_id,
      v_ret.warehouse_id,
      v_item.product_id,
      -(abs(v_item.qty) + coalesce(v_item.bonus_qty, 0)),
      'adjustment',
      'sale_returns',
      v_ret.id,
      true
    );
  end loop;

  -- Original sale return credited the customer; reverse with a debit.
  perform private.post_ledger(
    v_ret.organization_id,
    v_ret.company_id,
    v_ret.party_id,
    v_ret.return_date,
    v_ret.grand_total,
    0,
    'Cancel sale return ' || v_ret.return_no,
    'sale_returns',
    v_ret.id,
    'SR'
  );

  update public.sale_returns
  set status = 'cancelled', updated_at = now()
  where id = v_ret.id;
end;
$function$;

create or replace function public.cancel_purchase_return(p_return_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ret public.purchase_returns%rowtype;
  v_item public.purchase_return_items%rowtype;
begin
  select * into v_ret from public.purchase_returns where id = p_return_id;
  if not found then raise exception 'Purchase return not found'; end if;
  if not private.can_write_company(v_ret.company_id) then raise exception 'No write access'; end if;
  if v_ret.status <> 'posted' then raise exception 'This purchase return is already cancelled'; end if;

  for v_item in
    select * from public.purchase_return_items where purchase_return_id = v_ret.id
  loop
    perform private.apply_stock_delta(
      v_ret.company_id,
      v_ret.warehouse_id,
      v_item.product_id,
      abs(v_item.qty),
      'adjustment',
      'purchase_returns',
      v_ret.id,
      true
    );
  end loop;

  -- Original purchase return debited the supplier; reverse with a credit.
  perform private.post_ledger(
    v_ret.organization_id,
    v_ret.company_id,
    v_ret.party_id,
    v_ret.return_date,
    0,
    v_ret.grand_total,
    'Cancel purchase return ' || v_ret.return_no,
    'purchase_returns',
    v_ret.id,
    'PR'
  );

  update public.purchase_returns
  set status = 'cancelled', updated_at = now()
  where id = v_ret.id;
end;
$function$;

grant execute on function public.cancel_purchase_invoice(uuid) to authenticated, service_role;
grant execute on function public.cancel_sale_return(uuid) to authenticated, service_role;
grant execute on function public.cancel_purchase_return(uuid) to authenticated, service_role;
