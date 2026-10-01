-- Sale returns can follow the original invoice: same rate, free qty, and a cap
-- so the return cannot exceed what that bill still has.

alter table public.sale_return_items
  add column if not exists bonus_qty numeric(14, 3) not null default 0;

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
  v_invoice uuid := nullif(p_payload->>'sale_invoice_id', '')::uuid;
  v_product uuid;
  v_qty numeric;
  v_bonus numeric;
  v_sold_qty numeric;
  v_sold_bonus numeric;
  v_ret_qty numeric;
  v_ret_bonus numeric;
  v_name text;
begin
  if not private.can_write_company(v_company_id) then
    raise exception 'No write access';
  end if;

  if v_invoice is not null then
    if not exists (
      select 1
      from public.sale_invoices s
      where s.id = v_invoice
        and s.company_id = v_company_id
        and s.party_id = v_party
        and s.status = 'posted'
    ) then
      raise exception 'Sale return must use the same customer as the posted invoice';
    end if;
  end if;

  v_no := public.next_document_no(v_company_id, 'sale_return', null);
  insert into public.sale_returns (
    organization_id, company_id, return_no, return_date, party_id, warehouse_id,
    sale_invoice_id, subtotal, discount_total, extra_discount, grand_total, narration, status, created_by
  ) values (
    v_org_id, v_company_id, v_no, v_date, v_party,
    (p_payload->>'warehouse_id')::uuid,
    v_invoice,
    coalesce((p_payload->>'subtotal')::numeric, 0),
    coalesce((p_payload->>'discount_total')::numeric, 0),
    v_extra,
    v_total, nullif(p_payload->>'narration', ''), 'posted', auth.uid()
  ) returning id into v_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    v_product := (v_item->>'product_id')::uuid;
    v_qty := abs(coalesce((v_item->>'qty')::numeric, 0));
    v_bonus := greatest(0, coalesce((v_item->>'bonus_qty')::numeric, 0));
    v_name := coalesce(nullif(v_item->>'product_name', ''), nullif(v_item->>'product_code', ''), 'item');

    if v_invoice is not null then
      select coalesce(sum(i.qty), 0), coalesce(sum(i.bonus_qty), 0)
        into v_sold_qty, v_sold_bonus
      from public.sale_invoice_items i
      where i.sale_invoice_id = v_invoice
        and i.product_id = v_product;

      select coalesce(sum(ri.qty), 0), coalesce(sum(ri.bonus_qty), 0)
        into v_ret_qty, v_ret_bonus
      from public.sale_return_items ri
      join public.sale_returns r on r.id = ri.sale_return_id
      where r.sale_invoice_id = v_invoice
        and r.status = 'posted'
        and ri.product_id = v_product;

      if v_sold_qty = 0 and v_sold_bonus = 0 then
        raise exception 'Product % is not on that sale invoice', v_name;
      end if;
      if v_ret_qty + v_qty > v_sold_qty + 0.0005 then
        raise exception 'Return qty for % is more than that invoice still has', v_name;
      end if;
      if v_ret_bonus + v_bonus > v_sold_bonus + 0.0005 then
        raise exception 'Return free qty for % is more than that invoice still has', v_name;
      end if;
    end if;

    insert into public.sale_return_items (
      sale_return_id, company_id, product_id, product_code, product_name,
      qty, bonus_qty, rate, discount, amount, sort_order
    ) values (
      v_id, v_company_id, v_product, v_item->>'product_code', v_item->>'product_name',
      v_qty, v_bonus, coalesce((v_item->>'rate')::numeric, 0),
      coalesce((v_item->>'discount')::numeric, 0),
      coalesce((v_item->>'amount')::numeric, 0), v_idx
    );

    perform private.apply_stock_delta(
      v_company_id, (p_payload->>'warehouse_id')::uuid, v_product,
      v_qty + v_bonus, 'sale_return', 'sale_returns', v_id, true
    );
    v_idx := v_idx + 1;
  end loop;

  perform private.post_ledger(v_org_id, v_company_id, v_party, v_date, 0, v_total,
    'Sale return ' || v_no, 'sale_returns', v_id, 'SR');
  return v_id;
end;
$function$;

-- Returned free qty restores cost the same way billed qty does.
do $$
declare
  def text;
begin
  def := pg_get_functiondef('public.get_profit_summary(uuid, date, date)'::regprocedure);
  def := replace(
    def,
    'sum(ri.qty * coalesce(p.purchase_rate, 0))',
    'sum((ri.qty + coalesce(ri.bonus_qty, 0)) * coalesce(p.purchase_rate, 0))'
  );
  execute def;
end $$;
