-- Edit a posted document in place: same id and number.
-- Old stock and ledger rows are removed, then the new lines are posted.
-- Delete still uses the cancel_* functions (status cancelled, effects reversed).

create or replace function public.update_sale_invoice(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := (p_payload->>'invoice_id')::uuid;
  v_inv public.sale_invoices%rowtype;
  v_item public.sale_invoice_items%rowtype;
  v_line jsonb;
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
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
begin
  select * into v_inv from public.sale_invoices where id = v_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if not private.can_write_company(v_inv.company_id) then raise exception 'No write access'; end if;
  if v_inv.status <> 'posted' then raise exception 'This invoice is already cancelled'; end if;
  if v_company_id is distinct from v_inv.company_id then raise exception 'Company does not match this invoice'; end if;
  if exists (
    select 1 from public.sale_returns r
    where r.sale_invoice_id = v_inv.id and r.status = 'posted'
  ) then
    raise exception 'A sale return is already posted against this invoice';
  end if;

  for v_item in
    select * from public.sale_invoice_items where sale_invoice_id = v_inv.id
  loop
    select coalesce(p.default_warehouse_id, v_inv.warehouse_id)
      into v_stock_wh
    from public.products p
    where p.id = v_item.product_id;
    if v_stock_wh is null then v_stock_wh := v_inv.warehouse_id; end if;
    perform private.apply_stock_delta(
      v_inv.company_id, v_stock_wh, v_item.product_id,
      abs(v_item.qty) + coalesce(v_item.bonus_qty, 0),
      'adjustment', 'sale_invoices', v_inv.id, true
    );
  end loop;

  delete from public.ledger_entries
  where ref_table = 'sale_invoices' and ref_id = v_inv.id;
  delete from public.sale_invoice_items where sale_invoice_id = v_inv.id;

  select coalesce(c.sale_stock_policy, 'confirm') into v_policy
  from public.companies c where c.id = v_company_id;

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

  update public.sale_invoices set
    invoice_date = v_date,
    party_id = v_party,
    warehouse_id = v_header_wh,
    salesman_id = nullif(p_payload->>'salesman_id','')::uuid,
    route = nullif(p_payload->>'route',''),
    city = nullif(p_payload->>'city',''),
    payment_type = v_payment,
    subtotal = coalesce((p_payload->>'subtotal')::numeric, 0),
    discount_total = coalesce((p_payload->>'discount_total')::numeric, 0),
    extra_discount = greatest(0, coalesce((p_payload->>'extra_discount')::numeric, 0)),
    grand_total = v_total,
    amount_paid = v_paid,
    narration = nullif(p_payload->>'narration',''),
    updated_by = auth.uid(),
    updated_at = now()
  where id = v_inv.id;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    v_qty := coalesce((v_line->>'qty')::numeric, 0);
    v_bonus := greatest(0, coalesce((v_line->>'bonus_qty')::numeric, 0));
    v_need := abs(v_qty) + v_bonus;
    v_product_id := (v_line->>'product_id')::uuid;
    v_name := coalesce(nullif(v_line->>'product_name', ''), nullif(v_line->>'product_code', ''), 'item');

    select coalesce(p.default_warehouse_id, v_header_wh) into v_stock_wh
    from public.products p where p.id = v_product_id;
    if v_stock_wh is null then v_stock_wh := v_header_wh; end if;

    select coalesce(sb.qty, 0) into v_on_hand
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
      v_inv.id, v_company_id, v_product_id,
      v_line->>'product_code', v_line->>'product_name',
      v_qty, v_bonus, (v_line->>'rate')::numeric,
      coalesce((v_line->>'discount')::numeric, 0),
      nullif(v_line->>'scheme',''),
      (v_line->>'amount')::numeric, v_idx
    );
    perform private.apply_stock_delta(
      v_company_id, v_stock_wh, v_product_id,
      -abs(v_qty + v_bonus), 'sale', 'sale_invoices', v_inv.id, v_policy <> 'block'
    );
    v_idx := v_idx + 1;
  end loop;

  perform private.post_ledger(v_org_id, v_company_id, v_party, v_date, v_total, 0,
    'Sale ' || v_inv.invoice_no, 'sale_invoices', v_inv.id, 'SI');
  if v_paid > 0 then
    perform private.post_ledger(v_org_id, v_company_id, v_party, v_date, 0, v_paid,
      'Cash on sale ' || v_inv.invoice_no, 'sale_invoices', v_inv.id, 'CR');
  end if;

  return v_inv.id;
end;
$function$;

create or replace function public.update_purchase_invoice(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := (p_payload->>'invoice_id')::uuid;
  v_inv public.purchase_invoices%rowtype;
  v_item public.purchase_invoice_items%rowtype;
  v_line jsonb;
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_party uuid := (p_payload->>'party_id')::uuid;
  v_wh uuid := (p_payload->>'warehouse_id')::uuid;
  v_total numeric := coalesce((p_payload->>'grand_total')::numeric, 0);
  v_date date := coalesce((p_payload->>'invoice_date')::date, current_date);
  v_idx int := 0;
begin
  select * into v_inv from public.purchase_invoices where id = v_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if not private.can_write_company(v_inv.company_id) then raise exception 'No write access'; end if;
  if v_inv.status <> 'posted' then raise exception 'This invoice is already cancelled'; end if;
  if v_company_id is distinct from v_inv.company_id then raise exception 'Company does not match this invoice'; end if;
  if exists (
    select 1 from public.purchase_returns r
    where r.purchase_invoice_id = v_inv.id and r.status = 'posted'
  ) then
    raise exception 'A purchase return is already posted against this invoice';
  end if;

  for v_item in
    select * from public.purchase_invoice_items where purchase_invoice_id = v_inv.id
  loop
    perform private.apply_stock_delta(
      v_inv.company_id, v_inv.warehouse_id, v_item.product_id,
      -abs(v_item.qty), 'adjustment', 'purchase_invoices', v_inv.id, true
    );
  end loop;

  delete from public.ledger_entries
  where ref_table = 'purchase_invoices' and ref_id = v_inv.id;
  delete from public.purchase_invoice_items where purchase_invoice_id = v_inv.id;

  update public.purchase_invoices set
    supplier_bill_no = nullif(p_payload->>'supplier_bill_no',''),
    invoice_date = v_date,
    party_id = v_party,
    warehouse_id = v_wh,
    subtotal = coalesce((p_payload->>'subtotal')::numeric, 0),
    discount_total = coalesce((p_payload->>'discount_total')::numeric, 0),
    extra_discount = greatest(0, coalesce((p_payload->>'extra_discount')::numeric, 0)),
    grand_total = v_total,
    narration = nullif(p_payload->>'narration',''),
    updated_at = now()
  where id = v_inv.id;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    insert into public.purchase_invoice_items (
      purchase_invoice_id, company_id, product_id, product_code, product_name,
      qty, rate, discount, amount, sort_order
    ) values (
      v_inv.id, v_company_id, (v_line->>'product_id')::uuid,
      v_line->>'product_code', v_line->>'product_name',
      (v_line->>'qty')::numeric, (v_line->>'rate')::numeric,
      coalesce((v_line->>'discount')::numeric, 0),
      (v_line->>'amount')::numeric, v_idx
    );
    perform private.apply_stock_delta(
      v_company_id, v_wh, (v_line->>'product_id')::uuid,
      abs((v_line->>'qty')::numeric), 'purchase', 'purchase_invoices', v_inv.id, true
    );
    v_idx := v_idx + 1;
  end loop;

  perform private.post_ledger(v_org_id, v_company_id, v_party, v_date, 0, v_total,
    'Purchase ' || v_inv.invoice_no, 'purchase_invoices', v_inv.id, 'PI');
  return v_inv.id;
end;
$function$;

create or replace function public.update_sale_return(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := (p_payload->>'return_id')::uuid;
  v_ret public.sale_returns%rowtype;
  v_old public.sale_return_items%rowtype;
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_party uuid := (p_payload->>'party_id')::uuid;
  v_wh uuid := (p_payload->>'warehouse_id')::uuid;
  v_invoice uuid := nullif(p_payload->>'sale_invoice_id', '')::uuid;
  v_extra numeric := greatest(0, coalesce((p_payload->>'extra_discount')::numeric, 0));
  v_total numeric := coalesce((p_payload->>'grand_total')::numeric, 0);
  v_date date := coalesce((p_payload->>'return_date')::date, current_date);
  v_item jsonb;
  v_idx int := 0;
  v_product uuid;
  v_qty numeric;
  v_bonus numeric;
  v_sold_qty numeric;
  v_sold_bonus numeric;
  v_ret_qty numeric;
  v_ret_bonus numeric;
  v_name text;
  v_balance numeric;
  v_recovered numeric := 0;
begin
  select * into v_ret from public.sale_returns where id = v_id for update;
  if not found then raise exception 'Return not found'; end if;
  if not private.can_write_company(v_ret.company_id) then raise exception 'No write access'; end if;
  if v_ret.status <> 'posted' then raise exception 'This return is already cancelled'; end if;
  if v_company_id is distinct from v_ret.company_id then raise exception 'Company does not match this return'; end if;

  for v_old in select * from public.sale_return_items where sale_return_id = v_ret.id
  loop
    perform private.apply_stock_delta(
      v_ret.company_id, v_ret.warehouse_id, v_old.product_id,
      -(abs(v_old.qty) + coalesce(v_old.bonus_qty, 0)),
      'adjustment', 'sale_returns', v_ret.id, true
    );
  end loop;

  delete from public.ledger_entries
  where ref_table = 'sale_returns' and ref_id = v_ret.id;
  delete from public.sale_return_items where sale_return_id = v_ret.id;

  if v_invoice is not null then
    if not exists (
      select 1 from public.sale_invoices s
      where s.id = v_invoice
        and s.company_id = v_company_id
        and s.party_id = v_party
        and s.status = 'posted'
    ) then
      raise exception 'Sale return must use the same customer as the posted invoice';
    end if;
  end if;

  v_balance := coalesce(public.get_party_balance(v_company_id, v_party, v_date), 0);
  if v_total > v_balance + 0.005 then
    select coalesce(sum(r.amount), 0) into v_recovered
    from public.recoveries r
    where r.company_id = v_company_id
      and r.party_id = v_party
      and r.amount > 0
      and r.recovery_date <= v_date;
    if v_balance <= 0.005 then
      raise exception
        'This customer has no amount due. A sale return would create credit. Cancel the recovery first if goods are coming back.%',
        case when v_recovered > 0.005 then
          format(' Recoveries already recorded: %s.', trim(to_char(v_recovered, '9999999999990.99')))
        else '' end;
    end if;
    raise exception
      'This customer only owes %s. A return of %s would create credit. Cancel the recovery first, or return only the unpaid amount.%',
      trim(to_char(v_balance, '9999999999990.99')),
      trim(to_char(v_total, '9999999999990.99')),
      case when v_recovered > 0.005 then
        format(' Recoveries already recorded: %s.', trim(to_char(v_recovered, '9999999999990.99')))
      else '' end;
  end if;

  update public.sale_returns set
    return_date = v_date,
    party_id = v_party,
    warehouse_id = v_wh,
    sale_invoice_id = v_invoice,
    subtotal = coalesce((p_payload->>'subtotal')::numeric, 0),
    discount_total = coalesce((p_payload->>'discount_total')::numeric, 0),
    extra_discount = v_extra,
    grand_total = v_total,
    narration = nullif(p_payload->>'narration', ''),
    updated_at = now()
  where id = v_ret.id;

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
      where i.sale_invoice_id = v_invoice and i.product_id = v_product;

      select coalesce(sum(ri.qty), 0), coalesce(sum(ri.bonus_qty), 0)
        into v_ret_qty, v_ret_bonus
      from public.sale_return_items ri
      join public.sale_returns r on r.id = ri.sale_return_id
      where r.sale_invoice_id = v_invoice
        and r.status = 'posted'
        and r.id <> v_ret.id
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
      v_ret.id, v_company_id, v_product, v_item->>'product_code', v_item->>'product_name',
      v_qty, v_bonus, coalesce((v_item->>'rate')::numeric, 0),
      coalesce((v_item->>'discount')::numeric, 0),
      coalesce((v_item->>'amount')::numeric, 0), v_idx
    );
    perform private.apply_stock_delta(
      v_company_id, v_wh, v_product,
      v_qty + v_bonus, 'sale_return', 'sale_returns', v_ret.id, true
    );
    v_idx := v_idx + 1;
  end loop;

  perform private.post_ledger(v_org_id, v_company_id, v_party, v_date, 0, v_total,
    'Sale return ' || v_ret.return_no, 'sale_returns', v_ret.id, 'SR');
  return v_ret.id;
end;
$function$;

create or replace function public.update_purchase_return(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := (p_payload->>'return_id')::uuid;
  v_ret public.purchase_returns%rowtype;
  v_old public.purchase_return_items%rowtype;
  v_line jsonb;
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_party uuid := (p_payload->>'party_id')::uuid;
  v_wh uuid := (p_payload->>'warehouse_id')::uuid;
  v_extra numeric := greatest(0, coalesce((p_payload->>'extra_discount')::numeric, 0));
  v_total numeric := coalesce((p_payload->>'grand_total')::numeric, 0);
  v_date date := coalesce((p_payload->>'return_date')::date, current_date);
  v_idx int := 0;
begin
  select * into v_ret from public.purchase_returns where id = v_id for update;
  if not found then raise exception 'Return not found'; end if;
  if not private.can_write_company(v_ret.company_id) then raise exception 'No write access'; end if;
  if v_ret.status <> 'posted' then raise exception 'This return is already cancelled'; end if;
  if v_company_id is distinct from v_ret.company_id then raise exception 'Company does not match this return'; end if;

  for v_old in select * from public.purchase_return_items where purchase_return_id = v_ret.id
  loop
    perform private.apply_stock_delta(
      v_ret.company_id, v_ret.warehouse_id, v_old.product_id,
      abs(v_old.qty), 'adjustment', 'purchase_returns', v_ret.id, true
    );
  end loop;

  delete from public.ledger_entries
  where ref_table = 'purchase_returns' and ref_id = v_ret.id;
  delete from public.purchase_return_items where purchase_return_id = v_ret.id;

  update public.purchase_returns set
    return_date = v_date,
    party_id = v_party,
    warehouse_id = v_wh,
    purchase_invoice_id = nullif(p_payload->>'purchase_invoice_id','')::uuid,
    subtotal = coalesce((p_payload->>'subtotal')::numeric, 0),
    discount_total = coalesce((p_payload->>'discount_total')::numeric, 0),
    extra_discount = v_extra,
    grand_total = v_total,
    narration = nullif(p_payload->>'narration',''),
    updated_at = now()
  where id = v_ret.id;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    insert into public.purchase_return_items (
      purchase_return_id, company_id, product_id, product_code, product_name,
      qty, rate, discount, amount, sort_order
    ) values (
      v_ret.id, v_company_id, (v_line->>'product_id')::uuid,
      v_line->>'product_code', v_line->>'product_name',
      (v_line->>'qty')::numeric, (v_line->>'rate')::numeric,
      coalesce((v_line->>'discount')::numeric, 0),
      (v_line->>'amount')::numeric, v_idx
    );
    perform private.apply_stock_delta(
      v_company_id, v_wh, (v_line->>'product_id')::uuid,
      -abs((v_line->>'qty')::numeric), 'purchase_return', 'purchase_returns', v_ret.id, false
    );
    v_idx := v_idx + 1;
  end loop;

  perform private.post_ledger(v_org_id, v_company_id, v_party, v_date, v_total, 0,
    'Purchase return ' || v_ret.return_no, 'purchase_returns', v_ret.id, 'PR');
  return v_ret.id;
end;
$function$;

create or replace function public.update_cash_receipt(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := (p_payload->>'voucher_id')::uuid;
  v_v public.vouchers%rowtype;
  v_line jsonb;
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_date date := coalesce((p_payload->>'voucher_date')::date, current_date);
  v_total numeric := 0;
  v_idx int := 0;
begin
  select * into v_v from public.vouchers where id = v_id for update;
  if not found then raise exception 'Voucher not found'; end if;
  if not private.can_write_company(v_v.company_id) then raise exception 'No write access'; end if;
  if v_v.status <> 'posted' then raise exception 'This voucher is already cancelled'; end if;
  if v_v.voucher_type <> 'CR' then raise exception 'This is not a cash receipt'; end if;
  if v_company_id is distinct from v_v.company_id then raise exception 'Company does not match this voucher'; end if;
  if exists (select 1 from public.recoveries r where r.voucher_id = v_v.id) then
    raise exception 'This receipt belongs to a customer recovery. Edit that recovery instead.';
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  loop
    v_total := v_total + coalesce((v_line->>'amount')::numeric, 0);
  end loop;
  if v_total <= 0 then raise exception 'Receipt total must be greater than zero'; end if;

  delete from public.ledger_entries where ref_table = 'vouchers' and ref_id = v_v.id;
  delete from public.voucher_lines where voucher_id = v_v.id;

  update public.vouchers set
    voucher_date = v_date,
    total_amount = v_total,
    narration = nullif(p_payload->>'narration',''),
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
      0, (v_line->>'amount')::numeric,
      coalesce(nullif(v_line->>'narration',''), 'Cash receipt ' || v_v.voucher_no),
      'vouchers', v_v.id, 'CR'
    );
    v_idx := v_idx + 1;
  end loop;
  return v_v.id;
end;
$function$;

create or replace function public.update_cash_payment(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := (p_payload->>'voucher_id')::uuid;
  v_v public.vouchers%rowtype;
  v_line jsonb;
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_date date := coalesce((p_payload->>'voucher_date')::date, current_date);
  v_total numeric := 0;
  v_idx int := 0;
begin
  select * into v_v from public.vouchers where id = v_id for update;
  if not found then raise exception 'Voucher not found'; end if;
  if not private.can_write_company(v_v.company_id) then raise exception 'No write access'; end if;
  if v_v.status <> 'posted' then raise exception 'This voucher is already cancelled'; end if;
  if v_v.voucher_type <> 'CP' then raise exception 'This is not a cash payment'; end if;
  if v_company_id is distinct from v_v.company_id then raise exception 'Company does not match this voucher'; end if;

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
$function$;

create or replace function public.update_journal_voucher(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := (p_payload->>'voucher_id')::uuid;
  v_v public.vouchers%rowtype;
  v_line jsonb;
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_date date := coalesce((p_payload->>'voucher_date')::date, current_date);
  v_total numeric := 0;
  v_idx int := 0;
begin
  select * into v_v from public.vouchers where id = v_id for update;
  if not found then raise exception 'Voucher not found'; end if;
  if not private.can_write_company(v_v.company_id) then raise exception 'No write access'; end if;
  if v_v.status <> 'posted' then raise exception 'This voucher is already cancelled'; end if;
  if v_v.voucher_type <> 'JV' then raise exception 'This is not a journal voucher'; end if;
  if v_company_id is distinct from v_v.company_id then raise exception 'Company does not match this voucher'; end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  loop
    if (v_line->>'debit_party_id') is null or (v_line->>'credit_party_id') is null then
      raise exception 'JV lines require debit and credit accounts';
    end if;
    if (v_line->>'debit_party_id') = (v_line->>'credit_party_id') then
      raise exception 'Debit and credit accounts must differ';
    end if;
    v_total := v_total + coalesce((v_line->>'amount')::numeric, 0);
  end loop;
  if v_total <= 0 then raise exception 'JV total must be greater than zero'; end if;

  delete from public.ledger_entries where ref_table = 'vouchers' and ref_id = v_v.id;
  delete from public.voucher_lines where voucher_id = v_v.id;

  update public.vouchers set
    voucher_date = v_date,
    total_amount = v_total,
    narration = nullif(p_payload->>'narration',''),
    updated_at = now()
  where id = v_v.id;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  loop
    insert into public.voucher_lines (
      voucher_id, company_id, debit_party_id, credit_party_id, amount, narration, sort_order
    ) values (
      v_v.id, v_company_id,
      (v_line->>'debit_party_id')::uuid,
      (v_line->>'credit_party_id')::uuid,
      (v_line->>'amount')::numeric,
      nullif(v_line->>'narration',''), v_idx
    );
    perform private.post_ledger(
      v_org_id, v_company_id, (v_line->>'debit_party_id')::uuid, v_date,
      (v_line->>'amount')::numeric, 0,
      coalesce(nullif(v_line->>'narration',''), 'JV ' || v_v.voucher_no),
      'vouchers', v_v.id, 'JV'
    );
    perform private.post_ledger(
      v_org_id, v_company_id, (v_line->>'credit_party_id')::uuid, v_date,
      0, (v_line->>'amount')::numeric,
      coalesce(nullif(v_line->>'narration',''), 'JV ' || v_v.voucher_no),
      'vouchers', v_v.id, 'JV'
    );
    v_idx := v_idx + 1;
  end loop;
  return v_v.id;
end;
$function$;

create or replace function public.update_recovery(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := (p_payload->>'recovery_id')::uuid;
  v_rec public.recoveries%rowtype;
  v_party_row public.parties%rowtype;
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_party uuid := (p_payload->>'party_id')::uuid;
  v_amount numeric := coalesce((p_payload->>'amount')::numeric, 0);
  v_date date := coalesce((p_payload->>'recovery_date')::date, current_date);
  v_balance numeric;
  v_note text;
begin
  select * into v_rec from public.recoveries where id = v_id for update;
  if not found then raise exception 'Recovery not found'; end if;
  if not private.can_write_company(v_rec.company_id) then raise exception 'No write access'; end if;
  if v_company_id is distinct from v_rec.company_id then raise exception 'Company does not match this recovery'; end if;
  if v_amount <= 0 then raise exception 'Recovery amount must be greater than zero'; end if;

  select * into v_party_row from public.parties where id = v_party and company_id = v_company_id;
  if not found then raise exception 'Party not found'; end if;

  if v_rec.voucher_id is not null then
    delete from public.ledger_entries
    where ref_table = 'vouchers' and ref_id = v_rec.voucher_id;
    delete from public.voucher_lines where voucher_id = v_rec.voucher_id;
  else
    delete from public.ledger_entries
    where ref_table = 'recoveries' and ref_id = v_rec.id;
  end if;

  v_balance := coalesce(public.get_party_balance(v_company_id, v_party, v_date), 0);
  if v_balance <= 0.005 then
    raise exception 'This customer has no amount due. The recovery was not saved.';
  end if;
  if v_amount > v_balance + 0.005 then
    raise exception 'Recovery is more than the amount due (%). The recovery was not saved.', v_balance;
  end if;

  v_note := coalesce(nullif(p_payload->>'remarks',''), 'Recovery');

  if v_rec.voucher_id is not null then
    update public.vouchers set
      voucher_date = v_date,
      total_amount = v_amount,
      narration = v_note,
      updated_at = now()
    where id = v_rec.voucher_id;
    insert into public.voucher_lines (voucher_id, company_id, party_id, amount, narration, sort_order)
    values (v_rec.voucher_id, v_company_id, v_party, v_amount, v_note, 0);
    perform private.post_ledger(
      v_org_id, v_company_id, v_party, v_date,
      0, v_amount, v_note, 'vouchers', v_rec.voucher_id, 'CR'
    );
  else
    perform private.post_ledger(
      v_org_id, v_company_id, v_party, v_date,
      0, v_amount, v_note, 'recoveries', v_rec.id, 'CR'
    );
  end if;

  update public.recoveries set
    party_id = v_party,
    recovery_date = v_date,
    amount = v_amount,
    remarks = nullif(p_payload->>'remarks',''),
    salesman_id = nullif(p_payload->>'salesman_id','')::uuid,
    route = coalesce(nullif(p_payload->>'route',''), v_party_row.route),
    city = coalesce(nullif(p_payload->>'city',''), v_party_row.city)
  where id = v_rec.id;

  return v_rec.id;
end;
$function$;

-- Journal delete: reverse both sides, then mark cancelled.
create or replace function public.cancel_voucher(p_voucher_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_v public.vouchers%rowtype;
  v_line public.voucher_lines%rowtype;
  v_recovery_id uuid;
begin
  select * into v_v from public.vouchers where id = p_voucher_id;
  if not found then raise exception 'Voucher not found'; end if;
  if not private.can_write_company(v_v.company_id) then raise exception 'No write access'; end if;
  if v_v.status = 'cancelled' then raise exception 'This voucher is already cancelled'; end if;
  if v_v.status <> 'posted' then raise exception 'Only posted vouchers can be cancelled'; end if;

  if v_v.voucher_type = 'CR' then
    select r.id into v_recovery_id
    from public.recoveries r
    where r.voucher_id = v_v.id
    limit 1;
    if v_recovery_id is not null then
      perform public.cancel_recovery(v_recovery_id);
      return;
    end if;
  end if;

  for v_line in
    select * from public.voucher_lines where voucher_id = v_v.id order by sort_order
  loop
    if v_v.voucher_type = 'CR' then
      perform private.post_ledger(
        v_v.organization_id, v_v.company_id, v_line.party_id, v_v.voucher_date,
        v_line.amount, 0,
        'Cancel ' || coalesce(v_v.voucher_no, 'CR'),
        'vouchers', v_v.id, 'CR'
      );
    elsif v_v.voucher_type = 'CP' then
      perform private.post_ledger(
        v_v.organization_id, v_v.company_id, v_line.party_id, v_v.voucher_date,
        0, v_line.amount,
        'Cancel ' || coalesce(v_v.voucher_no, 'CP'),
        'vouchers', v_v.id, 'CP'
      );
    elsif v_v.voucher_type = 'JV' then
      if v_line.debit_party_id is not null then
        perform private.post_ledger(
          v_v.organization_id, v_v.company_id, v_line.debit_party_id, v_v.voucher_date,
          0, v_line.amount,
          'Cancel ' || coalesce(v_v.voucher_no, 'JV'),
          'vouchers', v_v.id, 'JV'
        );
      end if;
      if v_line.credit_party_id is not null then
        perform private.post_ledger(
          v_v.organization_id, v_v.company_id, v_line.credit_party_id, v_v.voucher_date,
          v_line.amount, 0,
          'Cancel ' || coalesce(v_v.voucher_no, 'JV'),
          'vouchers', v_v.id, 'JV'
        );
      end if;
    end if;
  end loop;

  update public.vouchers
  set status = 'cancelled', updated_at = now()
  where id = v_v.id;
end;
$function$;

grant execute on function public.update_sale_invoice(jsonb) to authenticated, service_role;
grant execute on function public.update_purchase_invoice(jsonb) to authenticated, service_role;
grant execute on function public.update_sale_return(jsonb) to authenticated, service_role;
grant execute on function public.update_purchase_return(jsonb) to authenticated, service_role;
grant execute on function public.update_cash_receipt(jsonb) to authenticated, service_role;
grant execute on function public.update_cash_payment(jsonb) to authenticated, service_role;
grant execute on function public.update_journal_voucher(jsonb) to authenticated, service_role;
grant execute on function public.update_recovery(jsonb) to authenticated, service_role;
