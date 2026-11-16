-- Company claims filter stock by brand/warehouse; vendor is optional and separate.

alter table public.expiry_claims
  alter column party_id drop not null;

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
  v_date date := coalesce((p_payload->>'claim_date')::date, current_date);
  v_party uuid := nullif(p_payload->>'party_id', '')::uuid;
  v_qty numeric;
  v_rate numeric;
  v_pct numeric;
  v_gross numeric;
  v_amount numeric;
  v_subtotal numeric := 0;
  v_gst_mode text := lower(coalesce(nullif(p_payload->>'gst_mode', ''), 'amount'));
  v_gst_input numeric := greatest(coalesce((p_payload->>'gst_input')::numeric, 0), 0);
  v_gst numeric := 0;
  v_total numeric := 0;
begin
  if not private.can_write_company(v_company_id) then raise exception 'No write access'; end if;
  if v_gst_mode not in ('percent', 'amount') then
    raise exception 'GST must be a percent or an amount';
  end if;
  if v_party is not null and not exists (
    select 1 from public.parties p
    where p.id = v_party
      and p.company_id = v_company_id
      and p.party_type = 'PARTY'
      and coalesce(p.party_subtype, 'supplier') in ('supplier', 'both', 'customer')
  ) then
    raise exception 'Select a vendor';
  end if;

  v_no := public.next_document_no(v_company_id, 'expiry_claim', 'CLM-');

  insert into public.expiry_claims (
    organization_id, company_id, claim_no, claim_date, party_id, warehouse_id,
    subtotal, grand_total, gst_mode, gst_input, gst_amount,
    claim_status, narration, status, created_by
  ) values (
    v_org_id, v_company_id, v_no, v_date, v_party,
    nullif(p_payload->>'warehouse_id','')::uuid,
    0, 0, v_gst_mode, v_gst_input, 0,
    'open',
    nullif(p_payload->>'narration',''),
    'posted', auth.uid()
  ) returning id into v_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    v_qty := coalesce((v_item->>'qty')::numeric, 0);
    if v_qty <= 0 then
      continue;
    end if;
    v_rate := greatest(coalesce((v_item->>'rate')::numeric, 0), 0);
    v_pct := least(greatest(coalesce((v_item->>'discount_percent')::numeric, 0), 0), 100);
    v_gross := round(v_qty * v_rate, 2);
    if v_gross > 0 then
      v_amount := round(v_gross - least(v_gross, v_gross * v_pct / 100), 2);
    else
      v_amount := round(greatest(coalesce((v_item->>'amount')::numeric, 0), 0), 2);
    end if;

    insert into public.expiry_claim_items (
      claim_id, company_id, product_id, product_code, product_name,
      qty, rate, discount_percent, amount, sort_order
    ) values (
      v_id, v_company_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_code',
      v_item->>'product_name',
      v_qty,
      v_rate,
      v_pct,
      v_amount,
      v_idx
    );
    perform private.apply_expiry_stock_delta(
      v_company_id, (v_item->>'product_id')::uuid, -abs(v_qty),
      'claim', 'expiry_claims', v_id, false
    );
    v_subtotal := v_subtotal + v_amount;
    v_idx := v_idx + 1;
  end loop;

  if v_idx = 0 then
    raise exception 'Select expiry stock to send';
  end if;

  if v_gst_mode = 'percent' then
    v_gst := round(least(v_subtotal, v_subtotal * least(v_gst_input, 100) / 100), 2);
  else
    v_gst := round(least(v_subtotal, v_gst_input), 2);
  end if;
  v_total := round(greatest(v_subtotal - v_gst, 0), 2);

  update public.expiry_claims
  set subtotal = v_subtotal,
      gst_amount = v_gst,
      grand_total = v_total,
      updated_at = now()
  where id = v_id;

  if v_party is not null and v_total > 0.005 then
    perform private.post_ledger(
      v_org_id, v_company_id, v_party, v_date, v_total, 0,
      'Expiry claim ' || v_no, 'expiry_claims', v_id, 'CLM'
    );
  end if;
  return v_id;
end;
$function$;

create or replace function public.cancel_expiry_claim(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_doc public.expiry_claims%rowtype;
  v_item public.expiry_claim_items%rowtype;
begin
  select * into v_doc from public.expiry_claims where id = p_claim_id;
  if not found then raise exception 'Expiry claim not found'; end if;
  if not private.can_write_company(v_doc.company_id) then
    raise exception 'No write access';
  end if;
  if v_doc.status <> 'posted' then
    raise exception 'This expiry claim is already cancelled';
  end if;
  if coalesce(v_doc.claim_status, 'open') <> 'open' then
    raise exception 'This claim is already settled and cannot be deleted';
  end if;

  for v_item in
    select * from public.expiry_claim_items where claim_id = v_doc.id
  loop
    if coalesce(v_item.qty, 0) <> 0 then
      perform private.apply_expiry_stock_delta(
        v_doc.company_id,
        v_item.product_id,
        abs(v_item.qty),
        'adjust',
        'expiry_claims',
        v_doc.id,
        true
      );
    end if;
  end loop;

  if v_doc.party_id is not null then
    perform private.post_ledger(
      v_doc.organization_id,
      v_doc.company_id,
      v_doc.party_id,
      v_doc.claim_date,
      0,
      v_doc.grand_total,
      'Cancel expiry claim ' || v_doc.claim_no,
      'expiry_claims',
      v_doc.id,
      'CLM'
    );
  end if;

  update public.expiry_claims
  set status = 'cancelled', updated_at = now()
  where id = v_doc.id;
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

  if v_rej_total > 0 and v_claim.party_id is not null then
    perform private.post_ledger(
      v_org_id, v_company_id, v_claim.party_id, v_date, 0, v_rej_total,
      'Expiry claim rejected ' || v_claim.claim_no, 'expiry_settlements', v_id, 'SET'
    );
  end if;

  return v_id;
end;
$function$;

grant execute on function public.create_expiry_claim(jsonb) to authenticated, service_role;
grant execute on function public.cancel_expiry_claim(uuid) to authenticated, service_role;
grant execute on function public.settle_expiry_claim(jsonb) to authenticated, service_role;
