-- Prevent duplicate sale invoices when the client retries after a flaky network
-- (same pattern as recoveries: client_request_id + short duplicate window).

ALTER TABLE public.sale_invoices
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS sale_invoices_client_request_id_uidx
  ON public.sale_invoices (company_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_sale_invoice(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_id uuid;
  v_no text;
  v_item jsonb;
  v_idx int := 0;
  v_total numeric := coalesce((p_payload->>'grand_total')::numeric, 0);
  v_date date := coalesce((p_payload->>'invoice_date')::date, current_date);
  v_party uuid := nullif(p_payload->>'party_id', '')::uuid;
  v_header_wh uuid := (p_payload->>'warehouse_id')::uuid;
  v_qty numeric;
  v_bonus numeric;
  v_need numeric;
  v_on_hand numeric;
  v_product_id uuid;
  v_stock_wh uuid;
  v_name text;
  v_policy text := 'confirm';
  v_payment public.payment_type := coalesce(
    nullif(p_payload->>'payment_type', '')::public.payment_type,
    'credit'::public.payment_type
  );
  v_paid numeric := greatest(0, coalesce((p_payload->>'amount_paid')::numeric, 0));
  v_walkin boolean := coalesce((p_payload->>'walk_in')::boolean, false);
  v_request_id uuid := nullif(p_payload->>'client_request_id', '')::uuid;
  v_confirmed boolean := lower(coalesce(p_payload->>'confirm_duplicate', '')) in ('true', 't', '1');
begin
  if not private.can_write_company(v_company_id) then raise exception 'No write access'; end if;

  select coalesce(c.sale_stock_policy, 'confirm')
    into v_policy
  from public.companies c
  where c.id = v_company_id;

  v_paid := least(v_paid, v_total);

  if v_payment = 'credit' then
    v_paid := 0;
  elsif v_payment in ('cash', 'partial') then
    if v_paid >= v_total - 0.005 then
      v_payment := 'cash';
      v_paid := v_total;
    elsif v_paid > 0.005 then
      v_payment := 'partial';
    else
      raise exception 'Enter the amount received, or save the bill as Credit';
    end if;
  end if;

  if v_walkin then
    if v_payment <> 'cash' or v_paid < v_total - 0.005 then
      raise exception 'Walk-in customer must pay the full bill';
    end if;
  end if;

  if v_party is null then
    if v_walkin and v_payment = 'cash' then
      v_party := private.ensure_walkin_party(v_org_id, v_company_id);
    else
      raise exception 'Select a customer';
    end if;
  end if;

  if v_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_request_id::text, 0));
    select id into v_id
    from public.sale_invoices
    where company_id = v_company_id
      and client_request_id = v_request_id;
    if found then
      return v_id;
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_company_id::text || ':' || coalesce(v_party::text, 'none'), 0)
  );

  if not v_confirmed and exists (
    select 1
    from public.sale_invoices
    where company_id = v_company_id
      and party_id = v_party
      and invoice_date = v_date
      and grand_total = v_total
      and status = 'posted'
      and created_at > clock_timestamp() - interval '30 seconds'
  ) then
    raise exception 'This sale was just saved. It was not saved again.';
  end if;

  v_no := public.next_document_no(v_company_id, 'sale_invoice', null);

  insert into public.sale_invoices (
    organization_id, company_id, invoice_no, invoice_date, party_id, warehouse_id,
    salesman_id, route, city, payment_type, subtotal, discount_total, extra_discount,
    grand_total, amount_paid, narration, status, created_by, updated_by, client_request_id
  ) values (
    v_org_id, v_company_id, v_no, v_date, v_party,
    v_header_wh,
    nullif(p_payload->>'salesman_id','')::uuid,
    nullif(p_payload->>'route',''),
    nullif(p_payload->>'city',''),
    v_payment,
    coalesce((p_payload->>'subtotal')::numeric, 0),
    coalesce((p_payload->>'discount_total')::numeric, 0),
    greatest(0, coalesce((p_payload->>'extra_discount')::numeric, 0)),
    v_total,
    v_paid,
    nullif(p_payload->>'narration',''),
    'posted', auth.uid(), auth.uid(),
    v_request_id
  ) returning id into v_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    v_qty := coalesce((v_item->>'qty')::numeric, 0);
    v_bonus := greatest(0, coalesce((v_item->>'bonus_qty')::numeric, 0));
    v_need := abs(v_qty) + v_bonus;
    v_product_id := (v_item->>'product_id')::uuid;
    v_name := coalesce(nullif(v_item->>'product_name', ''), nullif(v_item->>'product_code', ''), 'item');

    select coalesce(p.default_warehouse_id, v_header_wh)
      into v_stock_wh
    from public.products p
    where p.id = v_product_id;

    if v_stock_wh is null then
      v_stock_wh := v_header_wh;
    end if;

    select coalesce(sb.qty, 0)
      into v_on_hand
    from public.stock_balances sb
    where sb.company_id = v_company_id
      and sb.warehouse_id = v_stock_wh
      and sb.product_id = v_product_id;
    v_on_hand := coalesce(v_on_hand, 0);

    if v_need > v_on_hand + 0.0005
       and v_need > greatest(v_on_hand, 0) * 10
       and v_need > greatest(v_on_hand, 0) + 200 then
      raise exception 'Quantity for % is far above stock on hand (%). Check the number.', v_name, v_on_hand;
    end if;

    if v_policy = 'block' and v_need > v_on_hand + 0.0005 then
      raise exception 'Only % available for %. This company does not sell past stock.', v_on_hand, v_name;
    end if;

    insert into public.sale_invoice_items (
      sale_invoice_id, company_id, product_id, product_code, product_name,
      qty, bonus_qty, rate, discount, scheme, amount, sort_order
    ) values (
      v_id, v_company_id,
      v_product_id,
      v_item->>'product_code',
      v_item->>'product_name',
      v_qty,
      v_bonus,
      (v_item->>'rate')::numeric,
      coalesce((v_item->>'discount')::numeric, 0),
      nullif(v_item->>'scheme',''),
      (v_item->>'amount')::numeric,
      v_idx
    );

    perform private.apply_stock_delta(
      v_company_id, v_stock_wh, v_product_id,
      -abs(v_qty + v_bonus), 'sale', 'sale_invoices', v_id, v_policy <> 'block'
    );
    v_idx := v_idx + 1;
  end loop;

  perform private.post_ledger(v_org_id, v_company_id, v_party, v_date, v_total, 0,
    'Sale ' || v_no, 'sale_invoices', v_id, 'SI');

  if v_paid > 0 then
    perform private.post_ledger(v_org_id, v_company_id, v_party, v_date, 0, v_paid,
      'Cash on sale ' || v_no, 'sale_invoices', v_id, 'CR');
  end if;

  return v_id;
end;
$function$;
