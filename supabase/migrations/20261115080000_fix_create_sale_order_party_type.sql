-- Shops use party_type = PARTY with party_subtype customer/both, not party_type = customer.
create or replace function public.create_sale_order(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid := (p_payload->>'company_id')::uuid;
  v_org uuid := (p_payload->>'organization_id')::uuid;
  v_party uuid := nullif(p_payload->>'party_id', '')::uuid;
  v_id uuid;
  v_salesman uuid;
  v_no text;
  v_seq int;
  v_item jsonb;
  v_idx int := 0;
  v_product uuid;
  v_qty numeric;
  v_wh uuid;
  v_rate numeric;
  v_code text;
  v_name text;
  v_is_salesman boolean;
begin
  if v_company is null or v_org is null then
    raise exception 'Company is required';
  end if;
  if v_party is null then
    raise exception 'Select a customer';
  end if;

  select exists (
    select 1
    from public.company_members m
    where m.company_id = v_company
      and m.user_id = auth.uid()
      and coalesce(m.is_active, true)
      and m.role = 'salesman'
  ) into v_is_salesman;

  if not v_is_salesman and not private.can_write_company(v_company) then
    raise exception 'No access to take this order';
  end if;

  if not exists (
    select 1 from public.parties p
    where p.id = v_party
      and p.company_id = v_company
      and p.party_type = 'PARTY'
      and coalesce(p.party_subtype, 'customer') in ('customer', 'both')
  ) then
    raise exception 'Select a customer';
  end if;

  select s.id into v_salesman
  from public.salesmen s
  where s.company_id = v_company
    and s.user_id = auth.uid()
    and s.is_active
  order by s.created_at
  limit 1;

  if v_salesman is null then
    v_salesman := nullif(p_payload->>'salesman_id', '')::uuid;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sale-order:' || v_company::text, 0));
  select coalesce(max(substring(order_no from '([0-9]+)$')::int), 0) + 1
    into v_seq
  from public.sale_orders
  where company_id = v_company;
  v_no := 'SO-' || lpad(v_seq::text, 4, '0');

  insert into public.sale_orders (
    organization_id, company_id, order_no, order_date, party_id, salesman_id, note, created_by
  ) values (
    v_org, v_company, v_no,
    coalesce((p_payload->>'order_date')::date, current_date),
    v_party, v_salesman, nullif(p_payload->>'note', ''), auth.uid()
  ) returning id into v_id;

  if jsonb_typeof(p_payload->'lines') <> 'array' or jsonb_array_length(p_payload->'lines') = 0 then
    raise exception 'Add at least one product';
  end if;

  for v_item in select * from jsonb_array_elements(p_payload->'lines')
  loop
    v_product := (v_item->>'product_id')::uuid;
    v_qty := coalesce((v_item->>'qty')::numeric, 0);
    if v_qty <= 0 then
      raise exception 'Quantity must be more than zero';
    end if;

    select
      p.default_warehouse_id,
      coalesce(nullif(p.sale_rate, 0), nullif(p.retail_rate, 0), 0),
      p.code,
      p.name_en
    into v_wh, v_rate, v_code, v_name
    from public.products p
    where p.id = v_product
      and p.company_id = v_company
      and p.is_active;

    if v_wh is null then
      raise exception 'Product has no company';
    end if;

    insert into public.sale_order_lines (
      order_id, company_id, product_id, warehouse_id, product_code, product_name,
      qty, rate, amount, sort_order
    ) values (
      v_id, v_company, v_product, v_wh, v_code, v_name,
      v_qty, v_rate, round(v_qty * v_rate, 2), v_idx
    );
    v_idx := v_idx + 1;
  end loop;

  return v_id;
end;
$function$;
