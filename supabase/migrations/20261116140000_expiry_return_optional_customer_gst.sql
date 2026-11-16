-- Customer expiry return: customer is optional, line discount and GST cut the bill.
-- No customer: record expiry stock for vendor claim, do not touch any ledger.

alter table public.expiry_receipts
  alter column party_id drop not null;

alter table public.expiry_receipts
  add column if not exists gst_mode text not null default 'amount',
  add column if not exists gst_input numeric not null default 0,
  add column if not exists gst_amount numeric not null default 0;

alter table public.expiry_receipts
  drop constraint if exists expiry_receipts_gst_mode_check;

alter table public.expiry_receipts
  add constraint expiry_receipts_gst_mode_check
  check (gst_mode in ('percent', 'amount'));

alter table public.expiry_receipt_items
  add column if not exists discount_percent numeric not null default 0;

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
  v_date date := coalesce((p_payload->>'receipt_date')::date, current_date);
  v_party uuid := nullif(p_payload->>'party_id', '')::uuid;
  v_qty numeric;
  v_rate numeric;
  v_pct numeric;
  v_gross numeric;
  v_amount numeric;
  v_subtotal numeric := 0;
  v_balance_only boolean := coalesce((p_payload->>'balance_only')::boolean, false);
  v_gst_mode text := lower(coalesce(nullif(p_payload->>'gst_mode', ''), 'amount'));
  v_gst_input numeric := greatest(coalesce((p_payload->>'gst_input')::numeric, 0), 0);
  v_gst numeric := 0;
  v_total numeric := 0;
  v_narration text;
begin
  if not private.can_write_company(v_company_id) then
    raise exception 'No write access';
  end if;
  if v_gst_mode not in ('percent', 'amount') then
    raise exception 'GST must be a percent or an amount';
  end if;
  if v_party is not null and not exists (
    select 1 from public.parties p
    where p.id = v_party
      and p.company_id = v_company_id
      and p.party_type = 'PARTY'
      and coalesce(p.party_subtype, 'customer') in ('customer', 'both')
  ) then
    raise exception 'Select a customer';
  end if;
  if v_balance_only and v_party is null then
    raise exception 'Old-sale balance return needs a customer';
  end if;

  v_no := public.next_document_no(v_company_id, 'expiry_receipt', 'EXR-');

  insert into public.expiry_receipts (
    organization_id, company_id, receipt_no, receipt_date, party_id,
    period_from, period_to, subtotal, grand_total, narration, status, created_by,
    balance_only, gst_mode, gst_input, gst_amount
  ) values (
    v_org_id, v_company_id, v_no, v_date, v_party,
    nullif(p_payload->>'period_from','')::date,
    nullif(p_payload->>'period_to','')::date,
    0, 0,
    nullif(p_payload->>'narration',''),
    'posted', auth.uid(),
    v_balance_only, v_gst_mode, v_gst_input, 0
  ) returning id into v_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    v_qty := coalesce((v_item->>'qty')::numeric, 0);
    v_rate := greatest(coalesce((v_item->>'rate')::numeric, 0), 0);
    v_pct := least(greatest(coalesce((v_item->>'discount_percent')::numeric, 0), 0), 100);
    v_gross := round(v_qty * v_rate, 2);
    if v_gross > 0 then
      v_amount := round(v_gross - least(v_gross, v_gross * v_pct / 100), 2);
    else
      v_amount := round(greatest(coalesce((v_item->>'amount')::numeric, 0), 0), 2);
    end if;

    insert into public.expiry_receipt_items (
      receipt_id, company_id, product_id, product_code, product_name,
      history_qty, history_amount, qty, rate, discount_percent, amount, sort_order
    ) values (
      v_id, v_company_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_code',
      v_item->>'product_name',
      coalesce((v_item->>'history_qty')::numeric, 0),
      coalesce((v_item->>'history_amount')::numeric, 0),
      v_qty,
      v_rate,
      v_pct,
      v_amount,
      v_idx
    );

    if not v_balance_only and v_qty > 0 then
      perform private.apply_expiry_stock_delta(
        v_company_id, (v_item->>'product_id')::uuid, v_qty,
        'receipt', 'expiry_receipts', v_id, true
      );
    end if;

    v_subtotal := v_subtotal + v_amount;
    v_idx := v_idx + 1;
  end loop;

  if v_idx = 0 then
    raise exception 'Add at least one expired item';
  end if;

  if v_gst_mode = 'percent' then
    v_gst := round(least(v_subtotal, v_subtotal * least(v_gst_input, 100) / 100), 2);
  else
    v_gst := round(least(v_subtotal, v_gst_input), 2);
  end if;
  v_total := round(greatest(v_subtotal - v_gst, 0), 2);

  if v_balance_only and v_total <= 0.005 then
    raise exception 'Balance-only expiry return needs a recover amount greater than zero';
  end if;

  update public.expiry_receipts
  set subtotal = v_subtotal,
      gst_amount = v_gst,
      grand_total = v_total,
      updated_at = now()
  where id = v_id;

  if v_party is not null then
    if v_balance_only then
      v_narration := format(
        'Expiry return (balance only — old/manual sale, no expiry stock) %s · credit %s',
        v_no,
        trim(to_char(v_total, '9999999999990.99'))
      );
    else
      v_narration := 'Expiry return ' || v_no;
    end if;
    if nullif(trim(coalesce(p_payload->>'narration','')), '') is not null then
      v_narration := v_narration || ' — ' || trim(p_payload->>'narration');
    end if;

    perform private.post_ledger(
      v_org_id, v_company_id, v_party, v_date, 0, v_total,
      v_narration, 'expiry_receipts', v_id, 'EXR'
    );
  end if;

  return v_id;
end;
$function$;

create or replace function public.cancel_expiry_receipt(p_receipt_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_doc public.expiry_receipts%rowtype;
  v_item public.expiry_receipt_items%rowtype;
begin
  select * into v_doc from public.expiry_receipts where id = p_receipt_id;
  if not found then raise exception 'Expiry receipt not found'; end if;
  if not private.can_write_company(v_doc.company_id) then
    raise exception 'No write access';
  end if;
  if v_doc.status <> 'posted' then
    raise exception 'This expiry receipt is already cancelled';
  end if;

  if not coalesce(v_doc.balance_only, false) then
    for v_item in
      select * from public.expiry_receipt_items where receipt_id = v_doc.id
    loop
      if coalesce(v_item.qty, 0) <> 0 then
        perform private.apply_expiry_stock_delta(
          v_doc.company_id,
          v_item.product_id,
          -abs(v_item.qty),
          'adjust',
          'expiry_receipts',
          v_doc.id,
          true
        );
      end if;
    end loop;
  end if;

  if v_doc.party_id is not null then
    perform private.post_ledger(
      v_doc.organization_id,
      v_doc.company_id,
      v_doc.party_id,
      v_doc.receipt_date,
      v_doc.grand_total,
      0,
      case
        when coalesce(v_doc.balance_only, false) then
          'Cancel expiry return (balance only) ' || v_doc.receipt_no
        else
          'Cancel expiry return ' || v_doc.receipt_no
      end,
      'expiry_receipts',
      v_doc.id,
      'EXR'
    );
  end if;

  update public.expiry_receipts
  set status = 'cancelled', updated_at = now()
  where id = v_doc.id;
end;
$function$;

grant execute on function public.create_expiry_receipt(jsonb) to authenticated, service_role;
grant execute on function public.cancel_expiry_receipt(uuid) to authenticated, service_role;
