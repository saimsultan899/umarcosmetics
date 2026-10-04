-- Cancel a posted recovery (duplicate / wrong amount).
-- Reverses the ledger credit, marks the cash receipt cancelled, removes the recovery row.

create or replace function public.cancel_recovery(p_recovery_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rec public.recoveries%rowtype;
  v_voucher public.vouchers%rowtype;
begin
  select * into v_rec from public.recoveries where id = p_recovery_id;
  if not found then
    raise exception 'Recovery not found';
  end if;

  if not private.can_write_company(v_rec.company_id) then
    raise exception 'No write access';
  end if;

  if coalesce(v_rec.amount, 0) <= 0 then
    raise exception 'This recovery has no amount to cancel';
  end if;

  if v_rec.voucher_id is not null then
    select * into v_voucher from public.vouchers where id = v_rec.voucher_id;
    if found then
      if v_voucher.status = 'cancelled' then
        raise exception 'This recovery is already cancelled';
      end if;

      perform private.post_ledger(
        v_rec.organization_id,
        v_rec.company_id,
        v_rec.party_id,
        v_rec.recovery_date,
        v_rec.amount,
        0,
        'Cancel recovery ' || coalesce(v_voucher.voucher_no, 'CR'),
        'vouchers',
        v_voucher.id,
        'CR'
      );

      update public.vouchers
      set status = 'cancelled', updated_at = now()
      where id = v_voucher.id;
    end if;
  else
    perform private.post_ledger(
      v_rec.organization_id,
      v_rec.company_id,
      v_rec.party_id,
      v_rec.recovery_date,
      v_rec.amount,
      0,
      'Cancel recovery',
      'recoveries',
      v_rec.id,
      'CR'
    );
  end if;

  delete from public.recoveries where id = v_rec.id;
end;
$function$;

grant execute on function public.cancel_recovery(uuid) to authenticated;
grant execute on function public.cancel_recovery(uuid) to service_role;
