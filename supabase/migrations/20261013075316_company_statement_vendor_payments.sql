-- Company statement: link brand warehouses to suppliers; tag cash payments
-- with payment method + warehouse so brand payable ledgers stay separate.

alter table public.warehouses
  add column if not exists default_supplier_id uuid references public.parties(id) on delete set null;

create index if not exists warehouses_default_supplier_idx
  on public.warehouses (company_id, default_supplier_id)
  where default_supplier_id is not null;

alter table public.vouchers
  add column if not exists payment_method text;

alter table public.vouchers
  add column if not exists warehouse_id uuid references public.warehouses(id) on delete set null;

update public.vouchers
set payment_method = 'cash'
where payment_method is null;

alter table public.vouchers
  alter column payment_method set default 'cash';

alter table public.vouchers
  alter column payment_method set not null;

alter table public.vouchers
  drop constraint if exists vouchers_payment_method_check;

alter table public.vouchers
  add constraint vouchers_payment_method_check
  check (payment_method in ('cash', 'bank_transfer', 'other'));

create index if not exists vouchers_company_warehouse_date_idx
  on public.vouchers (company_id, warehouse_id, voucher_date)
  where warehouse_id is not null;

create or replace function private.assert_warehouse_supplier(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_supplier_id uuid
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_supplier_id is null then
    return;
  end if;

  if not exists (
    select 1 from public.warehouses w
    where w.id = p_warehouse_id
      and w.company_id = p_company_id
  ) then
    raise exception 'Unknown company warehouse';
  end if;

  if not exists (
    select 1 from public.parties p
    where p.id = p_supplier_id
      and p.company_id = p_company_id
      and p.is_active = true
      and (
        p.party_subtype in ('supplier', 'both')
        or p.party_type = 'PARTY'
      )
  ) then
    raise exception 'Pick an active vendor / supplier for this company';
  end if;
end;
$$;

create or replace function public.set_warehouse_supplier(
  p_warehouse_id uuid,
  p_supplier_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_wh public.warehouses%rowtype;
  v_party public.parties%rowtype;
begin
  select * into v_wh from public.warehouses where id = p_warehouse_id;
  if not found then
    raise exception 'Warehouse not found';
  end if;
  if not private.can_write_company(v_wh.company_id) then
    raise exception 'No write access';
  end if;

  if p_supplier_id is not null then
    perform private.assert_warehouse_supplier(v_wh.company_id, p_warehouse_id, p_supplier_id);
  end if;

  update public.warehouses
  set default_supplier_id = p_supplier_id,
      updated_at = now()
  where id = p_warehouse_id;

  select * into v_wh from public.warehouses where id = p_warehouse_id;
  if v_wh.default_supplier_id is not null then
    select * into v_party from public.parties where id = v_wh.default_supplier_id;
  end if;

  return jsonb_build_object(
    'warehouse_id', v_wh.id,
    'supplier_id', v_wh.default_supplier_id,
    'supplier_code', v_party.party_code,
    'supplier_name', v_party.name_en
  );
end;
$$;

grant execute on function public.set_warehouse_supplier(uuid, uuid) to authenticated, service_role;

create or replace function public.create_cash_payment(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_id uuid;
  v_no text;
  v_line jsonb;
  v_idx int := 0;
  v_total numeric := 0;
  v_date date := coalesce((p_payload->>'voucher_date')::date, current_date);
  v_method text := lower(trim(coalesce(p_payload->>'payment_method', 'cash')));
  v_warehouse uuid := nullif(p_payload->>'warehouse_id', '')::uuid;
begin
  if not private.can_write_company(v_company_id) then
    raise exception 'No write access';
  end if;

  if v_method not in ('cash', 'bank_transfer', 'other') then
    raise exception 'Payment method must be cash, bank transfer, or other';
  end if;

  if v_warehouse is not null then
    if not exists (
      select 1 from public.warehouses
      where id = v_warehouse and company_id = v_company_id
    ) then
      raise exception 'Unknown company warehouse';
    end if;
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  loop
    v_total := v_total + coalesce((v_line->>'amount')::numeric, 0);
  end loop;
  if v_total <= 0 then
    raise exception 'Payment total must be greater than zero';
  end if;

  v_no := public.next_document_no(v_company_id, 'cash_payment', null);
  insert into public.vouchers (
    organization_id, company_id, voucher_type, voucher_no, voucher_date,
    total_amount, narration, status, created_by, payment_method, warehouse_id
  ) values (
    v_org_id, v_company_id, 'CP', v_no, v_date, v_total,
    nullif(p_payload->>'narration',''), 'posted', auth.uid(),
    v_method, v_warehouse
  ) returning id into v_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  loop
    insert into public.voucher_lines (voucher_id, company_id, party_id, amount, narration, sort_order)
    values (
      v_id, v_company_id, (v_line->>'party_id')::uuid, (v_line->>'amount')::numeric,
      nullif(v_line->>'narration',''), v_idx
    );
    perform private.post_ledger(
      v_org_id, v_company_id, (v_line->>'party_id')::uuid, v_date,
      (v_line->>'amount')::numeric, 0,
      coalesce(nullif(v_line->>'narration',''), 'Cash payment ' || v_no),
      'vouchers', v_id, 'CP'
    );
    v_idx := v_idx + 1;
  end loop;
  return v_id;
end;
$$;

grant execute on function public.create_cash_payment(jsonb) to authenticated, service_role;

create or replace function public.update_cash_payment(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid := (p_payload->>'voucher_id')::uuid;
  v_v public.vouchers%rowtype;
  v_line jsonb;
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_date date := coalesce((p_payload->>'voucher_date')::date, current_date);
  v_total numeric := 0;
  v_idx int := 0;
  v_method text := lower(trim(coalesce(p_payload->>'payment_method', 'cash')));
  v_warehouse uuid := nullif(p_payload->>'warehouse_id', '')::uuid;
begin
  perform set_config('app.replacing_document_lines', '1', true);
  select * into v_v from public.vouchers where id = v_id for update;
  if not found then raise exception 'Voucher not found'; end if;
  if not private.can_write_company(v_v.company_id) then raise exception 'No write access'; end if;
  if v_v.status <> 'posted' then raise exception 'This voucher is already cancelled'; end if;
  if v_v.voucher_type <> 'CP' then raise exception 'This is not a cash payment'; end if;
  if v_company_id is distinct from v_v.company_id then raise exception 'Company does not match this voucher'; end if;

  if v_method not in ('cash', 'bank_transfer', 'other') then
    raise exception 'Payment method must be cash, bank transfer, or other';
  end if;

  if v_warehouse is not null then
    if not exists (
      select 1 from public.warehouses
      where id = v_warehouse and company_id = v_company_id
    ) then
      raise exception 'Unknown company warehouse';
    end if;
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  loop
    v_total := v_total + coalesce((v_line->>'amount')::numeric, 0);
  end loop;
  if v_total <= 0 then raise exception 'Payment total must be greater than zero'; end if;

  delete from public.ledger_entries where ref_table = 'vouchers' and ref_id = v_v.id;
  delete from public.voucher_lines where voucher_id = v_v.id;

  update public.vouchers set
    voucher_date = v_date,
    total_amount = v_total,
    narration = nullif(p_payload->>'narration',''),
    payment_method = v_method,
    warehouse_id = v_warehouse,
    updated_at = now()
  where id = v_v.id;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  loop
    insert into public.voucher_lines (voucher_id, company_id, party_id, amount, narration, sort_order)
    values (
      v_v.id, v_company_id, (v_line->>'party_id')::uuid, (v_line->>'amount')::numeric,
      nullif(v_line->>'narration',''), v_idx
    );
    perform private.post_ledger(
      v_org_id, v_company_id, (v_line->>'party_id')::uuid, v_date,
      (v_line->>'amount')::numeric, 0,
      coalesce(nullif(v_line->>'narration',''), 'Cash payment ' || v_v.voucher_no),
      'vouchers', v_v.id, 'CP'
    );
    v_idx := v_idx + 1;
  end loop;
  return v_v.id;
end;
$$;

grant execute on function public.update_cash_payment(jsonb) to authenticated, service_role;
