-- Allow qty corrections / write-off on expiry on-hand (not saleable stock).

alter table public.expiry_stock_movements
  drop constraint if exists expiry_stock_movements_kind_chk;

alter table public.expiry_stock_movements
  add constraint expiry_stock_movements_kind_chk
    check (move_kind in ('receipt', 'claim', 'reject', 'adjust'));

create or replace function public.set_expiry_stock_qty(
  p_company_id uuid,
  p_product_id uuid,
  p_qty numeric,
  p_narration text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current numeric := 0;
  v_next numeric := greatest(0, coalesce(p_qty, 0));
  v_delta numeric;
begin
  if not private.can_write_company(p_company_id) then
    raise exception 'No write access';
  end if;
  if p_product_id is null then
    raise exception 'Select a product';
  end if;

  select coalesce(qty, 0) into v_current
  from public.expiry_stock_balances
  where company_id = p_company_id
    and product_id = p_product_id;

  v_delta := v_next - coalesce(v_current, 0);
  if v_delta = 0 then
    return;
  end if;

  perform private.apply_expiry_stock_delta(
    p_company_id,
    p_product_id,
    v_delta,
    'adjust',
    'expiry_stock_balances',
    p_product_id,
    true
  );
end;
$function$;

revoke all on function public.set_expiry_stock_qty(uuid, uuid, numeric, text) from public;
grant execute on function public.set_expiry_stock_qty(uuid, uuid, numeric, text) to authenticated;
