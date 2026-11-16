-- Let the salesman-order editor save the same line fields the sale invoice dialog edits.
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
  v_salesman uuid;
  v_item jsonb;
  v_idx int := 0;
  v_line_id uuid;
  v_product uuid;
  v_qty numeric;
  v_wh uuid;
  v_rate numeric;
  v_amount numeric;
  v_code text;
  v_name text;
  v_open_left int;
  v_existing public.sale_order_lines%rowtype;
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

  v_salesman := v_order.salesman_id;
  if p_payload ? 'salesman_id' then
    v_salesman := nullif(p_payload->>'salesman_id', '')::uuid;
    if v_salesman is not null and not exists (
      select 1 from public.salesmen s
      where s.id = v_salesman
        and s.company_id = v_order.company_id
        and s.is_active
    ) then
      raise exception 'Select a salesman';
    end if;
  end if;

  update public.sale_orders
  set party_id = v_party,
      salesman_id = v_salesman,
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
        select * into v_existing
        from public.sale_order_lines
        where id = v_line_id
          and order_id = v_id
          and status = 'open'
        for update;

        if not found then
          raise exception 'An open line could not be updated';
        end if;

        if v_product is distinct from v_existing.product_id then
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
        else
          v_wh := v_existing.warehouse_id;
          v_rate := v_existing.rate;
          v_code := v_existing.product_code;
          v_name := v_existing.product_name;
        end if;

        v_wh := coalesce(nullif(v_item->>'warehouse_id', '')::uuid, v_wh);
        v_rate := coalesce(nullif(v_item->>'rate', '')::numeric, v_rate);
        v_amount := coalesce(nullif(v_item->>'amount', '')::numeric, round(v_qty * v_rate, 2));

        update public.sale_order_lines
        set product_id = v_product,
            warehouse_id = v_wh,
            product_code = v_code,
            product_name = v_name,
            qty = v_qty,
            rate = v_rate,
            amount = v_amount
        where id = v_line_id;
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

        v_wh := coalesce(nullif(v_item->>'warehouse_id', '')::uuid, v_wh);
        v_rate := coalesce(nullif(v_item->>'rate', '')::numeric, v_rate);
        v_amount := coalesce(nullif(v_item->>'amount', '')::numeric, round(v_qty * v_rate, 2));

        select coalesce(max(sort_order), -1) + 1 into v_idx
        from public.sale_order_lines
        where order_id = v_id;

        insert into public.sale_order_lines (
          order_id, company_id, product_id, warehouse_id, product_code, product_name,
          qty, rate, amount, sort_order
        ) values (
          v_id, v_order.company_id, v_product, v_wh, v_code, v_name,
          v_qty, v_rate, v_amount, v_idx
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

grant execute on function public.update_sale_order(jsonb) to authenticated, service_role;
