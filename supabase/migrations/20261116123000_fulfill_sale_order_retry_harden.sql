-- Harden fulfill retries when the credit bill already posted but the browser lost the reply.
create or replace function public.fulfill_sale_order_company(
  p_order_id uuid,
  p_warehouse_id uuid,
  p_client_request_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.sale_orders%rowtype;
  v_route text;
  v_city text;
  v_invoice uuid;
  v_items jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_line record;
  v_open_left int;
  v_wh_name text;
begin
  if p_order_id is null or p_warehouse_id is null then
    raise exception 'Order and company are required';
  end if;

  select * into v_order
  from public.sale_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;
  if not private.can_write_company(v_order.company_id) then
    raise exception 'No write access';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'This order is cancelled';
  end if;

  select name into v_wh_name
  from public.warehouses
  where id = p_warehouse_id;

  -- Already billed for this company: reopen the same invoice instead of failing.
  select sol.sale_invoice_id into v_invoice
  from public.sale_order_lines sol
  where sol.order_id = p_order_id
    and sol.warehouse_id = p_warehouse_id
    and sol.status = 'fulfilled'
    and sol.sale_invoice_id is not null
  order by sol.sort_order
  limit 1;

  if v_invoice is not null
     and not exists (
       select 1
       from public.sale_order_lines sol
       where sol.order_id = p_order_id
         and sol.warehouse_id = p_warehouse_id
         and sol.status = 'open'
     ) then
    return v_invoice;
  end if;

  if p_client_request_id is not null then
    select id into v_invoice
    from public.sale_invoices
    where company_id = v_order.company_id
      and client_request_id = p_client_request_id;
    if found then
      update public.sale_order_lines
      set status = 'fulfilled',
          sale_invoice_id = v_invoice
      where order_id = p_order_id
        and warehouse_id = p_warehouse_id
        and status = 'open';

      select count(*) into v_open_left
      from public.sale_order_lines
      where order_id = p_order_id
        and status = 'open';

      update public.sale_orders
      set fulfilled_invoice_ids = (
            select array(
              select distinct x
              from unnest(coalesce(fulfilled_invoice_ids, '{}'::uuid[]) || v_invoice) as x
            )
          ),
          status = case when v_open_left = 0 then 'fulfilled' else 'open' end,
          updated_at = now()
      where id = p_order_id;

      return v_invoice;
    end if;
  end if;

  for v_line in
    select *
    from public.sale_order_lines
    where order_id = p_order_id
      and warehouse_id = p_warehouse_id
      and status = 'open'
    order by sort_order
    for update
  loop
    v_total := v_total + v_line.amount;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_line.product_id,
      'product_code', v_line.product_code,
      'product_name', v_line.product_name,
      'qty', v_line.qty,
      'bonus_qty', 0,
      'rate', v_line.rate,
      'discount', 0,
      'amount', v_line.amount
    ));
  end loop;

  if v_items = '[]'::jsonb then
    raise exception 'Nothing left to fulfil for %', coalesce(v_wh_name, 'this company');
  end if;

  select route, city into v_route, v_city
  from public.parties
  where id = v_order.party_id;

  begin
    v_invoice := public.create_sale_invoice(jsonb_build_object(
      'organization_id', v_order.organization_id,
      'company_id', v_order.company_id,
      'party_id', v_order.party_id,
      'warehouse_id', p_warehouse_id,
      'salesman_id', v_order.salesman_id,
      'route', v_route,
      'city', v_city,
      'invoice_date', current_date,
      'payment_type', 'credit',
      'amount_paid', 0,
      'subtotal', v_total,
      'discount_total', 0,
      'extra_discount', 0,
      'grand_total', v_total,
      'narration', 'Salesman order ' || v_order.order_no || ' · ' || coalesce(v_wh_name, 'company'),
      'confirm_duplicate', true,
      'client_request_id', p_client_request_id,
      'items', v_items
    ));
  exception
    when unique_violation then
      if p_client_request_id is null then
        raise exception 'Could not bill %: duplicate sale', coalesce(v_wh_name, 'this company');
      end if;
      select id into v_invoice
      from public.sale_invoices
      where company_id = v_order.company_id
        and client_request_id = p_client_request_id;
      if v_invoice is null then
        raise exception 'Could not bill %: duplicate sale', coalesce(v_wh_name, 'this company');
      end if;
    when others then
      raise exception 'Could not bill %: %', coalesce(v_wh_name, 'this company'), sqlerrm;
  end;

  update public.sale_order_lines
  set status = 'fulfilled',
      sale_invoice_id = v_invoice
  where order_id = p_order_id
    and warehouse_id = p_warehouse_id
    and status = 'open';

  select count(*) into v_open_left
  from public.sale_order_lines
  where order_id = p_order_id
    and status = 'open';

  update public.sale_orders
  set fulfilled_invoice_ids = (
        select array(
          select distinct x
          from unnest(coalesce(fulfilled_invoice_ids, '{}'::uuid[]) || v_invoice) as x
        )
      ),
      status = case when v_open_left = 0 then 'fulfilled' else 'open' end,
      updated_at = now()
  where id = p_order_id;

  return v_invoice;
end;
$function$;

grant execute on function public.fulfill_sale_order_company(uuid, uuid, uuid) to authenticated, service_role;
