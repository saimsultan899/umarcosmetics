-- Edit open salesman orders, cancel leftover companies, and make fulfill safer to retry.
drop function if exists public.fulfill_sale_order_company(uuid, uuid);
drop function if exists public.fulfill_sale_order_company(uuid, uuid, uuid);

create or replace function public.update_sale_order(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := (p_payload->>'id')::uuid;
  v_order public.sale_orders%rowtype;
  v_party uuid;
  v_item jsonb;
  v_idx int := 0;
  v_line_id uuid;
  v_product uuid;
  v_qty numeric;
  v_wh uuid;
  v_rate numeric;
  v_code text;
  v_name text;
  v_open_left int;
begin
  if v_id is null then
    raise exception 'Order is required';
  end if;

  select * into v_order
  from public.sale_orders
  where id = v_id
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
  if v_order.status = 'fulfilled' then
    raise exception 'This order is already billed';
  end if;

  v_party := coalesce(nullif(p_payload->>'party_id', '')::uuid, v_order.party_id);
  if not exists (
    select 1 from public.parties p
    where p.id = v_party
      and p.company_id = v_order.company_id
      and p.party_type = 'PARTY'
      and coalesce(p.party_subtype, 'customer') in ('customer', 'both')
  ) then
    raise exception 'Select a customer';
  end if;

  update public.sale_orders
  set party_id = v_party,
      note = nullif(p_payload->>'note', ''),
      order_date = coalesce((p_payload->>'order_date')::date, order_date),
      updated_at = now()
  where id = v_id;

  if jsonb_typeof(p_payload->'keep_line_ids') = 'array' then
    delete from public.sale_order_lines l
    where l.order_id = v_id
      and l.status = 'open'
      and not (
        l.id::text in (
          select jsonb_array_elements_text(p_payload->'keep_line_ids')
        )
      );
  end if;

  if jsonb_typeof(p_payload->'lines') = 'array' then
    for v_item in select * from jsonb_array_elements(p_payload->'lines')
    loop
      v_line_id := nullif(v_item->>'id', '')::uuid;
      v_product := (v_item->>'product_id')::uuid;
      v_qty := coalesce((v_item->>'qty')::numeric, 0);
      if v_qty <= 0 then
        raise exception 'Quantity must be more than zero';
      end if;

      if v_line_id is not null then
        update public.sale_order_lines
        set qty = v_qty,
            amount = round(v_qty * rate, 2)
        where id = v_line_id
          and order_id = v_id
          and status = 'open';
        if not found then
          raise exception 'An open line could not be updated';
        end if;
      else
        select
          p.default_warehouse_id,
          coalesce(nullif(p.sale_rate, 0), nullif(p.retail_rate, 0), 0),
          p.code,
          p.name_en
        into v_wh, v_rate, v_code, v_name
        from public.products p
        where p.id = v_product
          and p.company_id = v_order.company_id
          and p.is_active;

        if v_wh is null then
          raise exception 'Product has no company';
        end if;

        select coalesce(max(sort_order), -1) + 1 into v_idx
        from public.sale_order_lines
        where order_id = v_id;

        insert into public.sale_order_lines (
          order_id, company_id, product_id, warehouse_id, product_code, product_name,
          qty, rate, amount, sort_order
        ) values (
          v_id, v_order.company_id, v_product, v_wh, v_code, v_name,
          v_qty, v_rate, round(v_qty * v_rate, 2), v_idx
        );
      end if;
    end loop;
  end if;

  select count(*) into v_open_left
  from public.sale_order_lines
  where order_id = v_id
    and status = 'open';

  if v_open_left = 0 then
    if exists (
      select 1 from public.sale_order_lines
      where order_id = v_id and status = 'fulfilled'
    ) then
      update public.sale_orders
      set status = 'fulfilled', updated_at = now()
      where id = v_id;
    else
      raise exception 'Add at least one product';
    end if;
  end if;

  return v_id;
end;
$function$;

create or replace function public.cancel_sale_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.sale_orders%rowtype;
  v_fulfilled int;
  v_open int;
begin
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
    raise exception 'This order is already cancelled';
  end if;

  select
    count(*) filter (where status = 'fulfilled'),
    count(*) filter (where status = 'open')
  into v_fulfilled, v_open
  from public.sale_order_lines
  where order_id = p_order_id;

  if v_fulfilled > 0 and v_open > 0 then
    delete from public.sale_order_lines
    where order_id = p_order_id
      and status = 'open';
    update public.sale_orders
    set status = 'fulfilled', updated_at = now()
    where id = p_order_id;
    return;
  end if;

  if v_fulfilled > 0 then
    raise exception 'This order is already billed';
  end if;

  update public.sale_orders
  set status = 'cancelled', updated_at = now()
  where id = p_order_id;
end;
$function$;

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
              from unnest(fulfilled_invoice_ids || v_invoice) as x
            )
          ),
          status = case when v_open_left = 0 then 'fulfilled' else 'open' end,
          updated_at = now()
      where id = p_order_id;

      return v_invoice;
    end if;
  end if;

  select name into v_wh_name
  from public.warehouses
  where id = p_warehouse_id;

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
          from unnest(fulfilled_invoice_ids || v_invoice) as x
        )
      ),
      status = case when v_open_left = 0 then 'fulfilled' else 'open' end,
      updated_at = now()
  where id = p_order_id;

  return v_invoice;
end;
$function$;

grant execute on function public.update_sale_order(jsonb) to authenticated, service_role;
grant execute on function public.fulfill_sale_order_company(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.cancel_sale_order(uuid) to authenticated, service_role;
