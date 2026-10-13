-- Custom shop / customer display order for company lists and pickers.

alter table public.parties
  add column if not exists sort_order integer not null default 0;

create index if not exists parties_company_sort_order_idx
  on public.parties (company_id, sort_order, party_code);

-- Seed existing trading parties by current party_code order.
with ranked as (
  select
    id,
    row_number() over (
      partition by company_id
      order by party_code asc, name_en asc, id asc
    ) as rn
  from public.parties
  where party_type = 'PARTY'
)
update public.parties p
set sort_order = ranked.rn
from ranked
where p.id = ranked.id
  and p.sort_order = 0;

create or replace function public.reorder_shops(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_ids uuid[];
  v_id uuid;
  v_idx int := 0;
  v_full uuid[];
  v_visible uuid[];
  v_ordered uuid[] := '{}';
  v_pos int;
  v_seen boolean;
begin
  if v_company_id is null then
    raise exception 'Company is required';
  end if;
  if not private.can_write_company(v_company_id) then
    raise exception 'No write access';
  end if;

  select coalesce(array_agg((elem)::uuid), '{}'::uuid[])
  into v_ids
  from jsonb_array_elements_text(coalesce(p_payload->'party_ids', '[]'::jsonb)) as elem;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Pick at least one shop to arrange';
  end if;

  -- Full company shop list in current order (customers / both only).
  select coalesce(array_agg(p.id order by p.sort_order, p.party_code, p.name_en, p.id), '{}'::uuid[])
  into v_full
  from public.parties p
  where p.company_id = v_company_id
    and p.party_type = 'PARTY'
    and p.party_subtype in ('customer', 'both')
    and p.is_active = true;

  -- Validate every requested id belongs to this company shop set.
  foreach v_id in array v_ids
  loop
    if not (v_id = any (v_full)) then
      raise exception 'Unknown shop for this company';
    end if;
  end loop;

  -- Rebuild full order: keep non-visible shops in place; splice visible ones
  -- in their new relative order (works for overall and city/sector subsets).
  select coalesce(array_agg(x), '{}'::uuid[])
  into v_visible
  from unnest(v_full) as x
  where x = any (v_ids);

  v_pos := 1;
  foreach v_id in array v_full
  loop
    if v_id = any (v_visible) then
      if v_pos <= coalesce(array_length(v_ids, 1), 0) then
        v_ordered := array_append(v_ordered, v_ids[v_pos]);
        v_pos := v_pos + 1;
      end if;
    else
      v_ordered := array_append(v_ordered, v_id);
    end if;
  end loop;

  -- Append any ids that were somehow missing from the visible slice.
  foreach v_id in array v_ids
  loop
    v_seen := false;
    if v_id = any (v_ordered) then
      v_seen := true;
    end if;
    if not v_seen then
      v_ordered := array_append(v_ordered, v_id);
    end if;
  end loop;

  v_idx := 0;
  foreach v_id in array v_ordered
  loop
    v_idx := v_idx + 1;
    update public.parties
    set sort_order = v_idx,
        updated_at = now()
    where id = v_id
      and company_id = v_company_id;
  end loop;

  return jsonb_build_object(
    'company_id', v_company_id,
    'updated', v_idx
  );
end;
$$;

grant execute on function public.reorder_shops(jsonb) to authenticated, service_role;

create or replace function private.parties_assign_sort_order()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' and (new.sort_order is null or new.sort_order = 0) then
    select coalesce(max(sort_order), 0) + 1
    into new.sort_order
    from public.parties
    where company_id = new.company_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_parties_assign_sort_order on public.parties;
create trigger trg_parties_assign_sort_order
before insert on public.parties
for each row
execute function private.parties_assign_sort_order();
