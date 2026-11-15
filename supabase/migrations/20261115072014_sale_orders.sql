-- Salesman orders. Saving an order does not move stock or the customer ledger.
-- Fulfilling one company calls the existing create_sale_invoice.

create table if not exists public.sale_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  company_id uuid not null references public.companies (id),
  order_no text not null,
  order_date date not null default current_date,
  party_id uuid not null references public.parties (id),
  salesman_id uuid references public.salesmen (id) on delete set null,
  note text,
  status text not null default 'open'
    check (status in ('open', 'fulfilled', 'cancelled')),
  fulfilled_invoice_ids uuid[] not null default '{}',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, order_no)
);

create table if not exists public.sale_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.sale_orders (id) on delete cascade,
  company_id uuid not null references public.companies (id),
  product_id uuid not null references public.products (id),
  warehouse_id uuid not null references public.warehouses (id),
  product_code text,
  product_name text,
  qty numeric not null check (qty > 0),
  rate numeric not null default 0,
  amount numeric not null default 0,
  status text not null default 'open' check (status in ('open', 'fulfilled')),
  sale_invoice_id uuid references public.sale_invoices (id),
  sort_order int not null default 0
);

create index if not exists sale_orders_company_status_idx
  on public.sale_orders (company_id, status, order_date desc);

create index if not exists sale_order_lines_order_idx
  on public.sale_order_lines (order_id, warehouse_id, status);

alter table public.sale_orders enable row level security;
alter table public.sale_order_lines enable row level security;

drop policy if exists sale_orders_select on public.sale_orders;
create policy sale_orders_select on public.sale_orders
  for select to authenticated
  using (
    private.can_write_company(company_id)
    or created_by = auth.uid()
  );

drop policy if exists sale_order_lines_select on public.sale_order_lines;
create policy sale_order_lines_select on public.sale_order_lines
  for select to authenticated
  using (
    exists (
      select 1
      from public.sale_orders o
      where o.id = sale_order_lines.order_id
        and (
          private.can_write_company(o.company_id)
          or o.created_by = auth.uid()
        )
    )
  );

grant select on public.sale_orders, public.sale_order_lines to authenticated, service_role;

create or replace function public.create_sale_order(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
$$;

create or replace function public.fulfill_sale_order_company(
  p_order_id uuid,
  p_warehouse_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.sale_orders%rowtype;
  v_route text;
  v_city text;
  v_invoice uuid;
  v_items jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_line record;
  v_open_left int;
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
  if v_order.status <> 'open' then
    raise exception 'This order is not open';
  end if;

  for v_line in
    select *
    from public.sale_order_lines
    where order_id = p_order_id
      and warehouse_id = p_warehouse_id
      and status = 'open'
    order by sort_order
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
    raise exception 'Nothing left to fulfil for this company';
  end if;

  select route, city into v_route, v_city
  from public.parties
  where id = v_order.party_id;

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
    'narration', 'Salesman order ' || v_order.order_no,
    'confirm_duplicate', true,
    'items', v_items
  ));

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
  set fulfilled_invoice_ids = fulfilled_invoice_ids || v_invoice,
      status = case when v_open_left = 0 then 'fulfilled' else 'open' end,
      updated_at = now()
  where id = p_order_id;

  return v_invoice;
end;
$$;

create or replace function public.cancel_sale_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.sale_orders%rowtype;
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
  if v_order.status <> 'open' then
    raise exception 'This order is not open';
  end if;
  if exists (
    select 1 from public.sale_order_lines
    where order_id = p_order_id and status = 'fulfilled'
  ) then
    raise exception 'Part of this order is already billed';
  end if;

  update public.sale_orders
  set status = 'cancelled', updated_at = now()
  where id = p_order_id;
end;
$$;

grant execute on function public.create_sale_order(jsonb) to authenticated, service_role;
grant execute on function public.fulfill_sale_order_company(uuid, uuid) to authenticated, service_role;
grant execute on function public.cancel_sale_order(uuid) to authenticated, service_role;
