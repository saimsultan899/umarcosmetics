-- Invoice-level extra discount on sale/purchase returns (mirrors invoices).
alter table public.sale_returns
  add column if not exists extra_discount numeric(14, 2) not null default 0;

alter table public.purchase_returns
  add column if not exists extra_discount numeric(14, 2) not null default 0;

comment on column public.sale_returns.extra_discount is
  'Return-level extra discount after line trade discounts; reduces credited grand_total';

comment on column public.purchase_returns.extra_discount is
  'Return-level extra discount after line trade discounts; reduces vendor-credit grand_total';

create or replace function public.create_sale_return(p_payload jsonb)
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
  v_extra numeric := greatest(0, coalesce((p_payload->>'extra_discount')::numeric, 0));
  v_total numeric := coalesce((p_payload->>'grand_total')::numeric, 0);
  v_date date := coalesce((p_payload->>'return_date')::date, current_date);
  v_party uuid := (p_payload->>'party_id')::uuid;
begin
  if not private.can_write_company(v_company_id) then raise exception 'No write access'; end if;
  v_no := public.next_document_no(v_company_id, 'sale_return', null);
  insert into public.sale_returns (
    organization_id, company_id, return_no, return_date, party_id, warehouse_id,
    sale_invoice_id, subtotal, discount_total, extra_discount, grand_total, narration, status, created_by
  ) values (
    v_org_id, v_company_id, v_no, v_date, v_party,
    (p_payload->>'warehouse_id')::uuid,
    nullif(p_payload->>'sale_invoice_id','')::uuid,
    coalesce((p_payload->>'subtotal')::numeric, 0),
    coalesce((p_payload->>'discount_total')::numeric, 0),
    v_extra,
    v_total, nullif(p_payload->>'narration',''), 'posted', auth.uid()
  ) returning id into v_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    insert into public.sale_return_items (
      sale_return_id, company_id, product_id, product_code, product_name,
      qty, rate, discount, amount, sort_order
    ) values (
      v_id, v_company_id, (v_item->>'product_id')::uuid, v_item->>'product_code', v_item->>'product_name',
      (v_item->>'qty')::numeric, (v_item->>'rate')::numeric, coalesce((v_item->>'discount')::numeric,0),
      (v_item->>'amount')::numeric, v_idx
    );
    perform private.apply_stock_delta(
      v_company_id, (p_payload->>'warehouse_id')::uuid, (v_item->>'product_id')::uuid,
      abs((v_item->>'qty')::numeric), 'sale_return', 'sale_returns', v_id, true
    );
    v_idx := v_idx + 1;
  end loop;
  perform private.post_ledger(v_org_id, v_company_id, v_party, v_date, 0, v_total,
    'Sale return ' || v_no, 'sale_returns', v_id, 'SR');
  return v_id;
end;
$function$;

create or replace function public.create_purchase_return(p_payload jsonb)
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
  v_extra numeric := greatest(0, coalesce((p_payload->>'extra_discount')::numeric, 0));
  v_total numeric := coalesce((p_payload->>'grand_total')::numeric, 0);
  v_date date := coalesce((p_payload->>'return_date')::date, current_date);
  v_party uuid := (p_payload->>'party_id')::uuid;
begin
  if not private.can_write_company(v_company_id) then raise exception 'No write access'; end if;
  v_no := public.next_document_no(v_company_id, 'purchase_return', null);
  insert into public.purchase_returns (
    organization_id, company_id, return_no, return_date, party_id, warehouse_id,
    purchase_invoice_id, subtotal, discount_total, extra_discount, grand_total, narration, status, created_by
  ) values (
    v_org_id, v_company_id, v_no, v_date, v_party,
    (p_payload->>'warehouse_id')::uuid,
    nullif(p_payload->>'purchase_invoice_id','')::uuid,
    coalesce((p_payload->>'subtotal')::numeric, 0),
    coalesce((p_payload->>'discount_total')::numeric, 0),
    v_extra,
    v_total, nullif(p_payload->>'narration',''), 'posted', auth.uid()
  ) returning id into v_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    insert into public.purchase_return_items (
      purchase_return_id, company_id, product_id, product_code, product_name,
      qty, rate, discount, amount, sort_order
    ) values (
      v_id, v_company_id, (v_item->>'product_id')::uuid, v_item->>'product_code', v_item->>'product_name',
      (v_item->>'qty')::numeric, (v_item->>'rate')::numeric, coalesce((v_item->>'discount')::numeric,0),
      (v_item->>'amount')::numeric, v_idx
    );
    perform private.apply_stock_delta(
      v_company_id, (p_payload->>'warehouse_id')::uuid, (v_item->>'product_id')::uuid,
      -abs((v_item->>'qty')::numeric), 'purchase_return', 'purchase_returns', v_id, false
    );
    v_idx := v_idx + 1;
  end loop;
  perform private.post_ledger(v_org_id, v_company_id, v_party, v_date, v_total, 0,
    'Purchase return ' || v_no, 'purchase_returns', v_id, 'PR');
  return v_id;
end;
$function$;
