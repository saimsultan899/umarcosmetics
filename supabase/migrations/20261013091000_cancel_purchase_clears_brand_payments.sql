-- When the last posted purchase for a brand warehouse is cancelled,
-- also cancel brand-tagged cash payments so company-statement payable
-- does not keep a hanging negative outstanding.

create or replace function public.cancel_purchase_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inv public.purchase_invoices%rowtype;
  v_item public.purchase_invoice_items%rowtype;
  v_pay uuid;
begin
  select * into v_inv from public.purchase_invoices where id = p_invoice_id;
  if not found then raise exception 'Purchase invoice not found'; end if;
  if not private.can_write_company(v_inv.company_id) then raise exception 'No write access'; end if;
  if v_inv.status <> 'posted' then raise exception 'This purchase invoice is already cancelled'; end if;

  if exists (
    select 1
    from public.purchase_returns r
    where r.purchase_invoice_id = v_inv.id
      and r.status = 'posted'
  ) then
    raise exception 'A purchase return is already posted against this invoice';
  end if;

  for v_item in
    select * from public.purchase_invoice_items where purchase_invoice_id = v_inv.id
  loop
    perform private.apply_stock_delta(
      v_inv.company_id,
      v_inv.warehouse_id,
      v_item.product_id,
      -abs(v_item.qty),
      'adjustment',
      'purchase_invoices',
      v_inv.id,
      true
    );
  end loop;

  -- Original purchase credited the supplier; reverse with a debit.
  perform private.post_ledger(
    v_inv.organization_id,
    v_inv.company_id,
    v_inv.party_id,
    v_inv.invoice_date,
    v_inv.grand_total,
    0,
    'Cancel purchase ' || v_inv.invoice_no,
    'purchase_invoices',
    v_inv.id,
    'PI'
  );

  update public.purchase_invoices
  set status = 'cancelled', updated_at = now()
  where id = v_inv.id;

  -- No other posted purchases left on this brand → reverse brand-tagged CPs
  -- so company statement payable does not stay negative as an advance.
  if v_inv.warehouse_id is not null
     and not exists (
       select 1
       from public.purchase_invoices pi
       where pi.company_id = v_inv.company_id
         and pi.warehouse_id = v_inv.warehouse_id
         and pi.status = 'posted'
         and pi.id is distinct from v_inv.id
     )
  then
    for v_pay in
      select v.id
      from public.vouchers v
      where v.company_id = v_inv.company_id
        and v.warehouse_id = v_inv.warehouse_id
        and v.voucher_type = 'CP'
        and v.status = 'posted'
      order by v.voucher_date, v.created_at
    loop
      perform public.cancel_voucher(v_pay);
    end loop;
  end if;
end;
$function$;

grant execute on function public.cancel_purchase_invoice(uuid) to authenticated, service_role;
