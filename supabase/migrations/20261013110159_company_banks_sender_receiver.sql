-- Company bank list (editable, reorderable) and separate sender / receiver
-- details on bank transfer payments.

create table if not exists public.company_banks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_banks_name_unique unique (company_id, name)
);

create index if not exists company_banks_company_sort_idx
  on public.company_banks (company_id, sort_order, name);

alter table public.company_banks enable row level security;

drop policy if exists company_banks_select on public.company_banks;
create policy company_banks_select on public.company_banks
  for select using (private.has_company_access(company_id));

drop policy if exists company_banks_insert on public.company_banks;
create policy company_banks_insert on public.company_banks
  for insert with check (private.can_write_company(company_id));

drop policy if exists company_banks_update on public.company_banks;
create policy company_banks_update on public.company_banks
  for update using (private.can_write_company(company_id))
  with check (private.can_write_company(company_id));

drop policy if exists company_banks_delete on public.company_banks;
create policy company_banks_delete on public.company_banks
  for delete using (private.can_write_company(company_id));

grant select, insert, update, delete on public.company_banks to authenticated, service_role;

alter table public.vouchers
  add column if not exists sender_bank_name text,
  add column if not exists sender_account_name text,
  add column if not exists sender_account_no text,
  add column if not exists receiver_bank_name text,
  add column if not exists receiver_account_name text,
  add column if not exists receiver_account_no text;

-- Older payments stored one bank block; treat that as the receiver.
update public.vouchers
set
  receiver_bank_name = coalesce(receiver_bank_name, bank_name),
  receiver_account_name = coalesce(receiver_account_name, bank_account_name),
  receiver_account_no = coalesce(receiver_account_no, bank_account_no)
where payment_method = 'bank_transfer'
  and receiver_bank_name is null
  and bank_name is not null;

create or replace function public.ensure_company_banks(p_company_id uuid)
returns setof public.company_banks
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org uuid;
begin
  if not private.has_company_access(p_company_id) then
    raise exception 'No access';
  end if;

  select organization_id into v_org
  from public.companies
  where id = p_company_id;

  if v_org is null then
    raise exception 'Company not found';
  end if;

  if not exists (
    select 1 from public.company_banks where company_id = p_company_id
  ) and private.can_write_company(p_company_id) then
    insert into public.company_banks (organization_id, company_id, name, sort_order)
    select v_org, p_company_id, b.name, b.ord
    from (
      values
        (1, 'Easypaisa'),
        (2, 'JazzCash'),
        (3, 'Habib Bank Limited (HBL)'),
        (4, 'United Bank Limited (UBL)'),
        (5, 'MCB Bank'),
        (6, 'Allied Bank Limited (ABL)'),
        (7, 'National Bank of Pakistan (NBP)'),
        (8, 'Bank Alfalah'),
        (9, 'Meezan Bank'),
        (10, 'Faysal Bank'),
        (11, 'Askari Bank'),
        (12, 'Bank Al Habib'),
        (13, 'Habib Metropolitan Bank'),
        (14, 'Standard Chartered'),
        (15, 'JS Bank'),
        (16, 'Soneri Bank'),
        (17, 'BankIslami'),
        (18, 'Dubai Islamic Bank'),
        (19, 'The Bank of Punjab'),
        (20, 'Sindh Bank'),
        (21, 'Samba Bank'),
        (22, 'Summit Bank'),
        (23, 'Silkbank'),
        (24, 'First Women Bank'),
        (25, 'Zarai Taraqiati Bank (ZTBL)')
    ) as b(ord, name);
  end if;

  return query
  select *
  from public.company_banks
  where company_id = p_company_id
  order by sort_order, name;
end;
$$;

grant execute on function public.ensure_company_banks(uuid) to authenticated, service_role;

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
  v_sender_bank text := nullif(trim(coalesce(p_payload->>'sender_bank_name', '')), '');
  v_sender_name text := nullif(trim(coalesce(p_payload->>'sender_account_name', '')), '');
  v_sender_no text := nullif(trim(coalesce(p_payload->>'sender_account_no', '')), '');
  v_receiver_bank text := nullif(trim(coalesce(p_payload->>'receiver_bank_name', '')), '');
  v_receiver_name text := nullif(trim(coalesce(p_payload->>'receiver_account_name', '')), '');
  v_receiver_no text := nullif(trim(coalesce(p_payload->>'receiver_account_no', '')), '');
begin
  if not private.can_write_company(v_company_id) then
    raise exception 'No write access';
  end if;

  if v_method not in ('cash', 'bank_transfer', 'other') then
    raise exception 'Payment method must be cash, bank transfer, or other';
  end if;

  if v_method = 'bank_transfer' then
    if v_sender_bank is null or v_receiver_bank is null then
      raise exception 'Select the sender bank and the receiver bank';
    end if;
    if v_sender_name is null or v_receiver_name is null then
      raise exception 'Enter the sender name and the receiver name';
    end if;
    if v_sender_no is null or v_receiver_no is null then
      raise exception 'Enter the sender account number and the receiver account number';
    end if;
  else
    v_sender_bank := null;
    v_sender_name := null;
    v_sender_no := null;
    v_receiver_bank := null;
    v_receiver_name := null;
    v_receiver_no := null;
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
    total_amount, narration, status, created_by, payment_method, warehouse_id,
    bank_name, bank_account_name, bank_account_no,
    sender_bank_name, sender_account_name, sender_account_no,
    receiver_bank_name, receiver_account_name, receiver_account_no
  ) values (
    v_org_id, v_company_id, 'CP', v_no, v_date, v_total,
    nullif(p_payload->>'narration',''), 'posted', auth.uid(),
    v_method, v_warehouse,
    v_receiver_bank, v_receiver_name, v_receiver_no,
    v_sender_bank, v_sender_name, v_sender_no,
    v_receiver_bank, v_receiver_name, v_receiver_no
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
  v_sender_bank text := nullif(trim(coalesce(p_payload->>'sender_bank_name', '')), '');
  v_sender_name text := nullif(trim(coalesce(p_payload->>'sender_account_name', '')), '');
  v_sender_no text := nullif(trim(coalesce(p_payload->>'sender_account_no', '')), '');
  v_receiver_bank text := nullif(trim(coalesce(p_payload->>'receiver_bank_name', '')), '');
  v_receiver_name text := nullif(trim(coalesce(p_payload->>'receiver_account_name', '')), '');
  v_receiver_no text := nullif(trim(coalesce(p_payload->>'receiver_account_no', '')), '');
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

  if v_method = 'bank_transfer' then
    if v_sender_bank is null or v_receiver_bank is null then
      raise exception 'Select the sender bank and the receiver bank';
    end if;
    if v_sender_name is null or v_receiver_name is null then
      raise exception 'Enter the sender name and the receiver name';
    end if;
    if v_sender_no is null or v_receiver_no is null then
      raise exception 'Enter the sender account number and the receiver account number';
    end if;
  else
    v_sender_bank := null;
    v_sender_name := null;
    v_sender_no := null;
    v_receiver_bank := null;
    v_receiver_name := null;
    v_receiver_no := null;
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
    bank_name = v_receiver_bank,
    bank_account_name = v_receiver_name,
    bank_account_no = v_receiver_no,
    sender_bank_name = v_sender_bank,
    sender_account_name = v_sender_name,
    sender_account_no = v_sender_no,
    receiver_bank_name = v_receiver_bank,
    receiver_account_name = v_receiver_name,
    receiver_account_no = v_receiver_no,
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
