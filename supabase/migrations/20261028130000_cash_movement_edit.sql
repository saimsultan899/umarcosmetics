-- Edit one cash-book entry (opening, person, or a company loan pair).
-- Does not touch sales, recoveries, expenses, or vouchers.

create or replace function public.update_cash_movement(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid := (p_payload->>'id')::uuid;
  v_row public.cash_movements%rowtype;
  v_amount numeric := coalesce((p_payload->>'amount')::numeric, 0);
  v_date date := coalesce((p_payload->>'movement_date')::date, current_date);
  v_remarks text := nullif(btrim(p_payload->>'remarks'), '');
  v_left numeric;
  v_sister_cash numeric;
  v_hub uuid;
  v_sister uuid;
begin
  if v_amount <= 0 then
    raise exception 'Enter an amount';
  end if;
  select * into v_row from public.cash_movements where id = v_id;
  if v_row.id is null or not private.can_write_company(v_row.company_id) then
    raise exception 'No write access';
  end if;

  if v_row.kind in ('person_borrow', 'person_repay') then
    select coalesce(sum(
      case
        when id = v_row.id then
          case when v_row.kind = 'person_borrow' then v_amount else -v_amount end
        when kind = 'person_borrow' then amount
        when kind = 'person_repay' then -amount
        else 0
      end
    ), 0)
      into v_left
    from public.cash_movements
    where lender_id = v_row.lender_id;
    if v_left < -0.009 then
      raise exception 'Return is more than owed to this person';
    end if;
    update public.cash_movements
      set amount = v_amount, movement_date = v_date, remarks = v_remarks
      where id = v_row.id;
    return v_row.id;
  end if;

  if v_row.kind = 'opening' then
    update public.cash_movements
      set amount = v_amount, movement_date = v_date, remarks = v_remarks
      where id = v_row.id;
    return v_row.id;
  end if;

  if v_row.kind in ('company_borrow', 'company_repay') then
    if v_row.pair_id is null then
      raise exception 'No write access';
    end if;
    if exists (
      select 1 from public.cash_movements m
      where m.pair_id = v_row.pair_id
        and not private.can_write_company(m.company_id)
    ) then
      raise exception 'No write access';
    end if;

    select m.company_id, m.counterparty_company_id
      into v_hub, v_sister
    from public.cash_movements m
    where m.pair_id = v_row.pair_id
      and (
        (m.kind = 'company_borrow' and m.direction = 'in')
        or (m.kind = 'company_repay' and m.direction = 'out')
      )
    limit 1;

    if v_row.kind = 'company_borrow' then
      select private.cash_on_hand_unchecked(m.company_id, current_date) + m.amount
        into v_sister_cash
      from public.cash_movements m
      where m.pair_id = v_row.pair_id
        and m.direction = 'out';
      if v_amount > coalesce(v_sister_cash, 0) + 0.009 then
        raise exception 'That company does not have that much cash on hand';
      end if;
    end if;

    select coalesce(sum(
      case
        when m.pair_id = v_row.pair_id then
          case
            when m.kind = 'company_borrow' and m.direction = 'in' then v_amount
            when m.kind = 'company_repay' and m.direction = 'out' then -v_amount
            else 0
          end
        when m.kind = 'company_borrow' and m.direction = 'in' then m.amount
        when m.kind = 'company_repay' and m.direction = 'out' then -m.amount
        else 0
      end
    ), 0)
      into v_left
    from public.cash_movements m
    where m.company_id = v_hub
      and m.counterparty_company_id = v_sister;
    if v_left < -0.009 then
      raise exception 'Return is more than owed to this company';
    end if;

    update public.cash_movements
      set amount = v_amount, movement_date = v_date, remarks = v_remarks
      where pair_id = v_row.pair_id;
    return v_row.id;
  end if;

  raise exception 'No write access';
end;
$$;

grant execute on function public.update_cash_movement(jsonb) to authenticated, service_role;
