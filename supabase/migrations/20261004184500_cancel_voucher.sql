-- Cancel posted cash receipt (CR) or cash payment (CP) vouchers.
-- Recovery-linked receipts use cancel_recovery so the recovery row is removed too.

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

  if v_v.voucher_type = 'JV' then
    raise exception 'Journal vouchers cannot be cancelled from here yet';
  end if;

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
      -- Original receipt credited the party; reverse with a debit.
      perform private.post_ledger(
        v_v.organization_id,
        v_v.company_id,
        v_line.party_id,
        v_v.voucher_date,
        v_line.amount,
        0,
        'Cancel ' || coalesce(v_v.voucher_no, 'CR'),
        'vouchers',
        v_v.id,
        'CR'
      );
    elsif v_v.voucher_type = 'CP' then
      -- Original payment debited the party; reverse with a credit.
      perform private.post_ledger(
        v_v.organization_id,
        v_v.company_id,
        v_line.party_id,
        v_v.voucher_date,
        0,
        v_line.amount,
        'Cancel ' || coalesce(v_v.voucher_no, 'CP'),
        'vouchers',
        v_v.id,
        'CP'
      );
    end if;
  end loop;

  update public.vouchers
  set status = 'cancelled', updated_at = now()
  where id = v_v.id;
end;
$function$;

grant execute on function public.cancel_voucher(uuid) to authenticated, service_role;
