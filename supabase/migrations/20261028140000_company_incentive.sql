-- Company incentive: the brand gives this to the distributor.
-- It posts like a company payment so it reduces the purchase bill and the
-- payable, but it is not cash, bank, or other, so it does not leave the drawer.

ALTER TABLE public.vouchers DROP CONSTRAINT IF EXISTS vouchers_payment_method_check;
ALTER TABLE public.vouchers
  ADD CONSTRAINT vouchers_payment_method_check
  CHECK (payment_method = ANY (ARRAY['cash'::text, 'bank_transfer'::text, 'other'::text, 'incentive'::text]));

CREATE OR REPLACE FUNCTION public.create_cash_payment(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_id uuid;
  v_no text;
  v_line jsonb;
  v_idx int := 0;
  v_total numeric := 0;
  v_alloc_total numeric := 0;
  v_item jsonb;
  v_date date := coalesce((p_payload->>'voucher_date')::date, current_date);
  v_method text := lower(trim(coalesce(p_payload->>'payment_method', 'cash')));
  v_warehouse uuid := nullif(p_payload->>'warehouse_id', '')::uuid;
  v_sender_bank text := nullif(trim(coalesce(p_payload->>'sender_bank_name', '')), '');
  v_sender_name text := nullif(trim(coalesce(p_payload->>'sender_account_name', '')), '');
  v_sender_no text := nullif(trim(coalesce(p_payload->>'sender_account_no', '')), '');
  v_receiver_bank text := nullif(trim(coalesce(p_payload->>'receiver_bank_name', '')), '');
  v_receiver_name text := nullif(trim(coalesce(p_payload->>'receiver_account_name', '')), '');
  v_receiver_no text := nullif(trim(coalesce(p_payload->>'receiver_account_no', '')), '');
BEGIN
  IF NOT private.can_write_company(v_company_id) THEN
    RAISE EXCEPTION 'No write access';
  END IF;

  IF v_method NOT IN ('cash', 'bank_transfer', 'other', 'incentive') THEN
    RAISE EXCEPTION 'Payment method must be cash, bank transfer, other, or incentive';
  END IF;

  IF v_method <> 'bank_transfer' THEN
    v_sender_bank := NULL;
    v_sender_name := NULL;
    v_sender_no := NULL;
    v_receiver_bank := NULL;
    v_receiver_name := NULL;
    v_receiver_no := NULL;
  END IF;

  IF v_warehouse IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.warehouses
      WHERE id = v_warehouse AND company_id = v_company_id
    ) THEN
      RAISE EXCEPTION 'Unknown company warehouse';
    END IF;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  LOOP
    v_total := v_total + coalesce((v_line->>'amount')::numeric, 0);
  END LOOP;
  IF v_total <= 0 THEN
    v_total := coalesce(nullif(p_payload->>'amount','')::numeric, 0);
  END IF;
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Payment total must be greater than zero';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'purchase_allocations', '[]'::jsonb))
  LOOP
    v_alloc_total := v_alloc_total + coalesce((v_item->>'amount')::numeric, 0);
  END LOOP;
  IF v_alloc_total > v_total + 0.005 THEN
    RAISE EXCEPTION 'Allocated amounts cannot exceed the payment total';
  END IF;

  v_no := public.next_document_no(v_company_id, 'cash_payment', NULL);
  INSERT INTO public.vouchers (
    organization_id, company_id, voucher_type, voucher_no, voucher_date,
    total_amount, narration, status, created_by, payment_method, warehouse_id,
    bank_name, bank_account_name, bank_account_no,
    sender_bank_name, sender_account_name, sender_account_no,
    receiver_bank_name, receiver_account_name, receiver_account_no
  ) VALUES (
    v_org_id, v_company_id, 'CP', v_no, v_date, v_total,
    nullif(p_payload->>'narration',''), 'posted', auth.uid(),
    v_method, v_warehouse,
    v_receiver_bank, v_receiver_name, v_receiver_no,
    v_sender_bank, v_sender_name, v_sender_no,
    v_receiver_bank, v_receiver_name, v_receiver_no
  ) RETURNING id INTO v_id;

  PERFORM private.insert_payment_allocations(
    v_company_id, v_warehouse, v_id, p_payload->'purchase_allocations'
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  LOOP
    IF nullif(v_line->>'party_id','') IS NOT NULL THEN
      INSERT INTO public.voucher_lines (voucher_id, company_id, party_id, amount, narration, sort_order)
      VALUES (
        v_id, v_company_id, (v_line->>'party_id')::uuid, (v_line->>'amount')::numeric,
        nullif(v_line->>'narration',''), v_idx
      );
      PERFORM private.post_ledger(
        v_org_id, v_company_id, (v_line->>'party_id')::uuid, v_date,
        (v_line->>'amount')::numeric, 0,
        coalesce(nullif(v_line->>'narration',''), case when v_method = 'incentive' then 'Incentive ' else 'Cash payment ' end || v_no),
        'vouchers', v_id, 'CP'
      );
    END IF;
    v_idx := v_idx + 1;
  END LOOP;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_cash_payment(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if v_method not in ('cash', 'bank_transfer', 'other', 'incentive') then
    raise exception 'Payment method must be cash, bank transfer, other, or incentive';
  end if;

  if v_method <> 'bank_transfer' then
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
    v_total := coalesce(nullif(p_payload->>'amount','')::numeric, 0);
  end if;
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
    if nullif(v_line->>'party_id','') is not null then
    insert into public.voucher_lines (voucher_id, company_id, party_id, amount, narration, sort_order)
    values (
      v_v.id, v_company_id, (v_line->>'party_id')::uuid, (v_line->>'amount')::numeric,
      nullif(v_line->>'narration',''), v_idx
    );
    perform private.post_ledger(
      v_org_id, v_company_id, (v_line->>'party_id')::uuid, v_date,
      (v_line->>'amount')::numeric, 0,
      coalesce(nullif(v_line->>'narration',''), case when v_method = 'incentive' then 'Incentive ' else 'Cash payment ' end || v_v.voucher_no),
      'vouchers', v_v.id, 'CP'
    );
    end if;
    v_idx := v_idx + 1;
  end loop;
  return v_v.id;
end;
$function$;

REVOKE ALL ON FUNCTION public.create_cash_payment(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_cash_payment(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_cash_payment(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_cash_payment(jsonb) TO authenticated, service_role;
