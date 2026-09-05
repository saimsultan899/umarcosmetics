-- Expiry warehouse: customer expired returns, vendor claims, settlement.
-- Isolated from saleable stock_balances.

create table if not exists public.expiry_stock_balances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  product_id uuid not null references public.products(id),
  qty numeric(14, 3) not null default 0,
  updated_at timestamptz not null default now(),
  unique (company_id, product_id)
);

create table if not exists public.expiry_stock_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  product_id uuid not null references public.products(id),
  qty numeric(14, 3) not null,
  move_kind text not null,
  ref_table text not null,
  ref_id uuid not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint expiry_stock_movements_kind_chk
    check (move_kind in ('receipt', 'claim', 'reject'))
);

create table if not exists public.expiry_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id),
  receipt_no text not null,
  receipt_date date not null default current_date,
  party_id uuid not null references public.parties(id),
  period_from date,
  period_to date,
  subtotal numeric(14, 2) not null default 0,
  grand_total numeric(14, 2) not null default 0,
  narration text,
  status public.doc_status not null default 'posted',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, receipt_no)
);

create table if not exists public.expiry_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.expiry_receipts(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  product_id uuid not null references public.products(id),
  product_code text not null,
  product_name text not null,
  history_qty numeric(14, 3) not null default 0,
  history_amount numeric(14, 2) not null default 0,
  qty numeric(14, 3) not null default 0,
  rate numeric(14, 2) not null default 0,
  amount numeric(14, 2) not null default 0,
  sort_order integer not null default 0
);

create table if not exists public.expiry_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id),
  claim_no text not null,
  claim_date date not null default current_date,
  party_id uuid not null references public.parties(id),
  warehouse_id uuid references public.warehouses(id),
  grand_total numeric(14, 2) not null default 0,
  accepted_amount numeric(14, 2) not null default 0,
  rejected_amount numeric(14, 2) not null default 0,
  claim_status text not null default 'open',
  narration text,
  status public.doc_status not null default 'posted',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, claim_no),
  constraint expiry_claims_status_chk check (claim_status in ('open', 'settled'))
);

create table if not exists public.expiry_claim_items (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.expiry_claims(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  product_id uuid not null references public.products(id),
  product_code text not null,
  product_name text not null,
  qty numeric(14, 3) not null default 0,
  rate numeric(14, 2) not null default 0,
  amount numeric(14, 2) not null default 0,
  accepted_qty numeric(14, 3) not null default 0,
  rejected_qty numeric(14, 3) not null default 0,
  accepted_amount numeric(14, 2) not null default 0,
  rejected_amount numeric(14, 2) not null default 0,
  sort_order integer not null default 0
);

create table if not exists public.expiry_settlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id),
  settlement_no text not null,
  settlement_date date not null default current_date,
  claim_id uuid not null references public.expiry_claims(id),
  kind text not null,
  accepted_amount numeric(14, 2) not null default 0,
  rejected_amount numeric(14, 2) not null default 0,
  narration text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (company_id, settlement_no),
  constraint expiry_settlements_kind_chk
    check (kind in ('financial', 'physical', 'mixed'))
);

create table if not exists public.expiry_settlement_items (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.expiry_settlements(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  claim_item_id uuid not null references public.expiry_claim_items(id),
  product_id uuid not null references public.products(id),
  product_code text not null,
  product_name text not null,
  accepted_qty numeric(14, 3) not null default 0,
  accepted_amount numeric(14, 2) not null default 0,
  rejected_qty numeric(14, 3) not null default 0,
  rejected_amount numeric(14, 2) not null default 0,
  sort_order integer not null default 0
);

create index if not exists expiry_receipts_company_date_idx
  on public.expiry_receipts (company_id, receipt_date desc);
create index if not exists expiry_receipt_items_receipt_idx
  on public.expiry_receipt_items (receipt_id, sort_order);
create index if not exists expiry_claims_company_date_idx
  on public.expiry_claims (company_id, claim_date desc);
create index if not exists expiry_claim_items_claim_idx
  on public.expiry_claim_items (claim_id, sort_order);
create index if not exists expiry_stock_balances_company_idx
  on public.expiry_stock_balances (company_id);

alter table public.expiry_stock_balances enable row level security;
alter table public.expiry_stock_movements enable row level security;
alter table public.expiry_receipts enable row level security;
alter table public.expiry_receipt_items enable row level security;
alter table public.expiry_claims enable row level security;
alter table public.expiry_claim_items enable row level security;
alter table public.expiry_settlements enable row level security;
alter table public.expiry_settlement_items enable row level security;

create policy expiry_stock_balances_select on public.expiry_stock_balances
  for select using (private.has_company_access(company_id));
create policy expiry_stock_movements_select on public.expiry_stock_movements
  for select using (private.has_company_access(company_id));
create policy expiry_receipts_select on public.expiry_receipts
  for select using (private.has_company_access(company_id));
create policy expiry_receipt_items_select on public.expiry_receipt_items
  for select using (private.has_company_access(company_id));
create policy expiry_claims_select on public.expiry_claims
  for select using (private.has_company_access(company_id));
create policy expiry_claim_items_select on public.expiry_claim_items
  for select using (private.has_company_access(company_id));
create policy expiry_settlements_select on public.expiry_settlements
  for select using (private.has_company_access(company_id));
create policy expiry_settlement_items_select on public.expiry_settlement_items
  for select using (private.has_company_access(company_id));

create or replace function private.apply_expiry_stock_delta(
  p_company_id uuid,
  p_product_id uuid,
  p_qty_delta numeric,
  p_move_kind text,
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
begin
  if p_qty_delta = 0 then
    return;
  end if;

  insert into public.expiry_stock_balances (company_id, product_id, qty)
  values (p_company_id, p_product_id, 0)
  on conflict (company_id, product_id) do nothing;

  update public.expiry_stock_balances
  set qty = qty + p_qty_delta,
      updated_at = now()
  where company_id = p_company_id
    and product_id = p_product_id
  returning qty into v_qty;

  if not p_allow_negative and v_qty < 0 then
    select coalesce(nullif(trim(code), '') || ' — ', '') || coalesce(nullif(trim(name_en), ''), 'Unknown product')
      into v_product_label
    from public.products
    where id = p_product_id;

    raise exception
      'Insufficient expiry stock for product % (available % after this move)',
      coalesce(v_product_label, p_product_id::text),
      coalesce(v_qty - p_qty_delta, 0);
  end if;

  insert into public.expiry_stock_movements (
    company_id, product_id, qty, move_kind, ref_table, ref_id, created_by
  ) values (
    p_company_id, p_product_id, p_qty_delta, p_move_kind, p_ref_table, p_ref_id, auth.uid()
  );
end;
$function$;

create or replace function public.get_customer_sale_history(
  p_company_id uuid,
  p_party_id uuid,
  p_from date,
  p_to date
)
returns table (
  product_id uuid,
  product_code text,
  product_name text,
  qty numeric,
  amount numeric,
  avg_rate numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not private.has_company_access(p_company_id) then
    raise exception 'No access to this company';
  end if;

  return query
  select
    i.product_id,
    max(i.product_code) as product_code,
    max(i.product_name) as product_name,
    sum(i.qty)::numeric as qty,
    sum(i.amount)::numeric as amount,
    case when sum(i.qty) > 0 then round(sum(i.amount) / sum(i.qty), 2) else 0 end as avg_rate
  from public.sale_invoice_items i
  join public.sale_invoices s on s.id = i.sale_invoice_id
  where s.company_id = p_company_id
    and s.party_id = p_party_id
    and s.status = 'posted'
    and s.invoice_date between p_from and p_to
    and i.product_id is not null
  group by i.product_id
  having sum(i.qty) > 0 or sum(i.amount) > 0
  order by max(i.product_name);
end;
$function$;

create or replace function public.create_expiry_receipt(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_id uuid;
  v_no text;
  v_item jsonb;
  v_idx int := 0;
  v_total numeric := coalesce((p_payload->>'grand_total')::numeric, 0);
  v_date date := coalesce((p_payload->>'receipt_date')::date, current_date);
  v_party uuid := (p_payload->>'party_id')::uuid;
  v_qty numeric;
begin
  if not private.can_write_company(v_company_id) then raise exception 'No write access'; end if;
  if v_party is null then raise exception 'Select a customer'; end if;

  v_no := public.next_document_no(v_company_id, 'expiry_receipt', 'EXR-');

  insert into public.expiry_receipts (
    organization_id, company_id, receipt_no, receipt_date, party_id,
    period_from, period_to, subtotal, grand_total, narration, status, created_by
  ) values (
    v_org_id, v_company_id, v_no, v_date, v_party,
    nullif(p_payload->>'period_from','')::date,
    nullif(p_payload->>'period_to','')::date,
    coalesce((p_payload->>'subtotal')::numeric, 0),
    v_total,
    nullif(p_payload->>'narration',''),
    'posted', auth.uid()
  ) returning id into v_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    v_qty := coalesce((v_item->>'qty')::numeric, 0);
    insert into public.expiry_receipt_items (
      receipt_id, company_id, product_id, product_code, product_name,
      history_qty, history_amount, qty, rate, amount, sort_order
    ) values (
      v_id, v_company_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_code',
      v_item->>'product_name',
      coalesce((v_item->>'history_qty')::numeric, 0),
      coalesce((v_item->>'history_amount')::numeric, 0),
      v_qty,
      coalesce((v_item->>'rate')::numeric, 0),
      coalesce((v_item->>'amount')::numeric, 0),
      v_idx
    );
    if v_qty > 0 then
      perform private.apply_expiry_stock_delta(
        v_company_id, (v_item->>'product_id')::uuid, v_qty,
        'receipt', 'expiry_receipts', v_id, true
      );
    end if;
    v_idx := v_idx + 1;
  end loop;

  if v_idx = 0 then
    raise exception 'Add at least one expired item';
  end if;

  perform private.post_ledger(
    v_org_id, v_company_id, v_party, v_date, 0, v_total,
    'Expiry return ' || v_no, 'expiry_receipts', v_id, 'EXR'
  );
  return v_id;
end;
$function$;

create or replace function public.create_expiry_claim(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_id uuid;
  v_no text;
  v_item jsonb;
  v_idx int := 0;
  v_total numeric := coalesce((p_payload->>'grand_total')::numeric, 0);
  v_date date := coalesce((p_payload->>'claim_date')::date, current_date);
  v_party uuid := (p_payload->>'party_id')::uuid;
  v_qty numeric;
begin
  if not private.can_write_company(v_company_id) then raise exception 'No write access'; end if;
  if v_party is null then raise exception 'Select a vendor'; end if;

  v_no := public.next_document_no(v_company_id, 'expiry_claim', 'CLM-');

  insert into public.expiry_claims (
    organization_id, company_id, claim_no, claim_date, party_id, warehouse_id,
    grand_total, claim_status, narration, status, created_by
  ) values (
    v_org_id, v_company_id, v_no, v_date, v_party,
    nullif(p_payload->>'warehouse_id','')::uuid,
    v_total, 'open',
    nullif(p_payload->>'narration',''),
    'posted', auth.uid()
  ) returning id into v_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    v_qty := coalesce((v_item->>'qty')::numeric, 0);
    if v_qty <= 0 then
      continue;
    end if;
    insert into public.expiry_claim_items (
      claim_id, company_id, product_id, product_code, product_name,
      qty, rate, amount, sort_order
    ) values (
      v_id, v_company_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_code',
      v_item->>'product_name',
      v_qty,
      coalesce((v_item->>'rate')::numeric, 0),
      coalesce((v_item->>'amount')::numeric, 0),
      v_idx
    );
    perform private.apply_expiry_stock_delta(
      v_company_id, (v_item->>'product_id')::uuid, -abs(v_qty),
      'claim', 'expiry_claims', v_id, false
    );
    v_idx := v_idx + 1;
  end loop;

  if v_idx = 0 then
    raise exception 'Select expiry stock to send to the vendor';
  end if;

  perform private.post_ledger(
    v_org_id, v_company_id, v_party, v_date, v_total, 0,
    'Expiry claim ' || v_no, 'expiry_claims', v_id, 'CLM'
  );
  return v_id;
end;
$function$;

create or replace function public.settle_expiry_claim(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_claim_id uuid := (p_payload->>'claim_id')::uuid;
  v_id uuid;
  v_no text;
  v_item jsonb;
  v_idx int := 0;
  v_date date := coalesce((p_payload->>'settlement_date')::date, current_date);
  v_claim public.expiry_claims%rowtype;
  v_line public.expiry_claim_items%rowtype;
  v_acc_qty numeric;
  v_rej_qty numeric;
  v_acc_amt numeric;
  v_rej_amt numeric;
  v_acc_total numeric := 0;
  v_rej_total numeric := 0;
  v_kind text;
begin
  if not private.can_write_company(v_company_id) then raise exception 'No write access'; end if;

  select * into v_claim
  from public.expiry_claims
  where id = v_claim_id and company_id = v_company_id
  for update;

  if not found then raise exception 'Claim not found'; end if;
  if v_claim.claim_status <> 'open' then raise exception 'This claim is already settled'; end if;

  v_no := public.next_document_no(v_company_id, 'expiry_settlement', 'SET-');

  insert into public.expiry_settlements (
    organization_id, company_id, settlement_no, settlement_date, claim_id,
    kind, accepted_amount, rejected_amount, narration, created_by
  ) values (
    v_org_id, v_company_id, v_no, v_date, v_claim_id,
    'mixed', 0, 0, nullif(p_payload->>'narration',''), auth.uid()
  ) returning id into v_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    select * into v_line
    from public.expiry_claim_items
    where id = (v_item->>'claim_item_id')::uuid
      and claim_id = v_claim_id
    for update;

    if not found then
      raise exception 'Claim line not found';
    end if;

    v_acc_qty := greatest(0, coalesce((v_item->>'accepted_qty')::numeric, 0));
    v_rej_qty := greatest(0, coalesce((v_item->>'rejected_qty')::numeric, 0));
    if abs((v_acc_qty + v_rej_qty) - v_line.qty) > 0.001 then
      raise exception 'Accepted + rejected qty must equal sent qty for %', v_line.product_name;
    end if;

    v_acc_amt := greatest(0, coalesce((v_item->>'accepted_amount')::numeric,
      case when v_line.qty > 0 then round(v_line.amount * (v_acc_qty / v_line.qty), 2) else 0 end));
    v_rej_amt := greatest(0, coalesce((v_item->>'rejected_amount')::numeric,
      case when v_line.qty > 0 then round(v_line.amount * (v_rej_qty / v_line.qty), 2) else 0 end));

    update public.expiry_claim_items
    set accepted_qty = v_acc_qty,
        rejected_qty = v_rej_qty,
        accepted_amount = v_acc_amt,
        rejected_amount = v_rej_amt
    where id = v_line.id;

    insert into public.expiry_settlement_items (
      settlement_id, company_id, claim_item_id, product_id, product_code, product_name,
      accepted_qty, accepted_amount, rejected_qty, rejected_amount, sort_order
    ) values (
      v_id, v_company_id, v_line.id, v_line.product_id, v_line.product_code, v_line.product_name,
      v_acc_qty, v_acc_amt, v_rej_qty, v_rej_amt, v_idx
    );

    if v_rej_qty > 0 then
      perform private.apply_expiry_stock_delta(
        v_company_id, v_line.product_id, v_rej_qty,
        'reject', 'expiry_settlements', v_id, true
      );
    end if;

    v_acc_total := v_acc_total + v_acc_amt;
    v_rej_total := v_rej_total + v_rej_amt;
    v_idx := v_idx + 1;
  end loop;

  if v_idx = 0 then
    raise exception 'Settlement needs at least one line';
  end if;

  if v_rej_total > 0 and v_acc_total > 0 then
    v_kind := 'mixed';
  elsif v_rej_total > 0 then
    v_kind := 'physical';
  else
    v_kind := 'financial';
  end if;

  update public.expiry_settlements
  set kind = v_kind,
      accepted_amount = v_acc_total,
      rejected_amount = v_rej_total
  where id = v_id;

  update public.expiry_claims
  set claim_status = 'settled',
      accepted_amount = v_acc_total,
      rejected_amount = v_rej_total,
      updated_at = now()
  where id = v_claim_id;

  if v_rej_total > 0 then
    perform private.post_ledger(
      v_org_id, v_company_id, v_claim.party_id, v_date, 0, v_rej_total,
      'Expiry claim rejected ' || v_claim.claim_no, 'expiry_settlements', v_id, 'SET'
    );
  end if;

  return v_id;
end;
$function$;

revoke all on function public.get_customer_sale_history(uuid, uuid, date, date) from public;
revoke all on function public.create_expiry_receipt(jsonb) from public;
revoke all on function public.create_expiry_claim(jsonb) from public;
revoke all on function public.settle_expiry_claim(jsonb) from public;

grant execute on function public.get_customer_sale_history(uuid, uuid, date, date) to authenticated;
grant execute on function public.create_expiry_receipt(jsonb) to authenticated;
grant execute on function public.create_expiry_claim(jsonb) to authenticated;
grant execute on function public.settle_expiry_claim(jsonb) to authenticated;
