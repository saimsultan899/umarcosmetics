-- Show product code/name and warehouse name in insufficient-stock errors
create or replace function private.apply_stock_delta(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_product_id uuid,
  p_qty_delta numeric,
  p_move_type stock_move_type,
  p_ref_table text,
  p_ref_id uuid,
  p_allow_negative boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_qty numeric;
  v_product_label text;
  v_warehouse_label text;
begin
  insert into public.stock_balances (company_id, warehouse_id, product_id, qty)
  values (p_company_id, p_warehouse_id, p_product_id, 0)
  on conflict (company_id, warehouse_id, product_id) do nothing;

  update public.stock_balances
  set qty = qty + p_qty_delta,
      updated_at = now()
  where company_id = p_company_id
    and warehouse_id = p_warehouse_id
    and product_id = p_product_id
  returning qty into v_qty;

  if not p_allow_negative and v_qty < 0 then
    select coalesce(nullif(trim(code), '') || ' — ', '') || coalesce(nullif(trim(name_en), ''), 'Unknown product')
      into v_product_label
    from public.products
    where id = p_product_id;

    select coalesce(nullif(trim(name), ''), 'Unknown warehouse')
      into v_warehouse_label
    from public.warehouses
    where id = p_warehouse_id;

    raise exception
      'Insufficient stock for product % in warehouse % (available % after this move)',
      coalesce(v_product_label, p_product_id::text),
      coalesce(v_warehouse_label, p_warehouse_id::text),
      coalesce(v_qty - p_qty_delta, 0);
  end if;

  insert into public.stock_movements (
    company_id, warehouse_id, product_id, move_type, qty, ref_table, ref_id, created_by
  ) values (
    p_company_id, p_warehouse_id, p_product_id, p_move_type, p_qty_delta, p_ref_table, p_ref_id, auth.uid()
  );
end;
$function$;
