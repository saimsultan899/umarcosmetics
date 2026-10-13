-- Bank transfer payments store the Pakistan bank, account title, and account number.

alter table public.vouchers
  add column if not exists bank_name text;

alter table public.vouchers
  add column if not exists bank_account_name text;

alter table public.vouchers
  add column if not exists bank_account_no text;

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
  v_bank text := nullif(trim(coalesce(p_payload->>'bank_name', '')), '');
  v_account_name text := nullif(trim(coalesce(p_payload->>'bank_account_name', '')), '');
  v_account_no text := nullif(trim(coalesce(p_payload->>'bank_account_no', '')), '');
begin
  if not private.can_write_company(v_company_id) then
    raise exception 'No write access';
  end if;

  if v_method not in ('cash', 'bank_transfer', 'other') then
    raise exception 'Payment method must be cash, bank transfer, or other';
  end if;

  if v_method = 'bank_transfer' then
    if v_bank is null then
      raise exception 'Select a bank';
    end if;
    if v_account_name is null then
      raise exception 'Enter the account name';
    end if;
    if v_account_no is null then
      raise exception 'Enter the sender / receiver account number';
    end if;
  else
    v_bank := null;
    v_account_name := null;
    v_account_no := null;
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
    bank_name, bank_account_name, bank_account_no
  ) values (
    v_org_id, v_company_id, 'CP', v_no, v_date, v_total,
    nullif(p_payload->>'narration',''), 'posted', auth.uid(),
    v_method, v_warehouse,
    v_bank, v_account_name, v_account_no
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
  v_bank text := nullif(trim(coalesce(p_payload->>'bank_name', '')), '');
  v_account_name text := nullif(trim(coalesce(p_payload->>'bank_account_name', '')), '');
  v_account_no text := nullif(trim(coalesce(p_payload->>'bank_account_no', '')), '');
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
    if v_bank is null then
      raise exception 'Select a bank';
    end if;
    if v_account_name is null then
      raise exception 'Enter the account name';
    end if;
    if v_account_no is null then
      raise exception 'Enter the sender / receiver account number';
    end if;
  else
    v_bank := null;
    v_account_name := null;
    v_account_no := null;
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
    bank_name = v_bank,
    bank_account_name = v_account_name,
    bank_account_no = v_account_no,
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
