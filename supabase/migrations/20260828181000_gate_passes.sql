-- Incoming company load / gate pass. Document only — does not touch stock.
-- Physical goods are matched against this sheet, then posted via purchase invoice.

create table if not exists public.gate_passes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id),
  pass_no text not null,
  pass_date date not null default current_date,
  party_id uuid references public.parties(id),
  warehouse_id uuid references public.warehouses(id),
  manufacturer text,
  vehicle_no text,
  transporter text,
  po_no text,
  bilty_no text,
  remarks text,
  status public.doc_status not null default 'posted',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, pass_no)
);

create table if not exists public.gate_pass_items (
  id uuid primary key default gen_random_uuid(),
  gate_pass_id uuid not null references public.gate_passes(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  product_id uuid not null references public.products(id),
  product_code text not null,
  product_name text not null,
  qty numeric(14,3) not null default 0,
  sort_order integer not null default 0
);

create index if not exists gate_passes_company_date_idx
  on public.gate_passes (company_id, pass_date desc);
create index if not exists gate_pass_items_pass_idx
  on public.gate_pass_items (gate_pass_id, sort_order);

alter table public.gate_passes enable row level security;
alter table public.gate_pass_items enable row level security;

create policy gate_passes_select on public.gate_passes
  for select using (private.has_company_access(company_id));
create policy gate_pass_items_select on public.gate_pass_items
  for select using (private.has_company_access(company_id));

create or replace function public.next_document_no(
  p_company_id uuid,
  p_series_type doc_series_type,
  p_prefix text default null
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_next bigint;
  v_prefix text;
  v_padding int;
begin
  if not private.can_write_company(p_company_id) and not private.is_super_admin() then
    raise exception 'No write access';
  end if;

  insert into public.document_series (company_id, series_type, prefix, next_number, padding)
  values (
    p_company_id,
    p_series_type,
    coalesce(p_prefix, case p_series_type
      when 'sale_invoice' then 'SI-'
      when 'sale_return' then 'SR-'
      when 'purchase_invoice' then 'PI-'
      when 'purchase_return' then 'PR-'
      when 'stock_transfer' then 'ST-'
      when 'cash_receipt' then 'CR-'
      when 'cash_payment' then 'CP-'
      when 'journal_voucher' then 'JV-'
      when 'load_sheet' then 'LD-'
      when 'gate_pass' then 'GP-'
    end),
    1,
    4
  )
  on conflict (company_id, series_type) do nothing;

  update public.document_series
  set next_number = next_number + 1
  where company_id = p_company_id and series_type = p_series_type
  returning next_number - 1, prefix, padding into v_next, v_prefix, v_padding;

  return v_prefix || lpad(v_next::text, v_padding, '0');
end;
$function$;

create or replace function public.create_gate_pass(p_payload jsonb)
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
begin
  if not private.can_write_company(v_company_id) then
    raise exception 'No write access';
  end if;

  if jsonb_array_length(coalesce(p_payload->'items', '[]'::jsonb)) < 1 then
    raise exception 'Add at least one product line';
  end if;

  v_no := public.next_document_no(v_company_id, 'gate_pass', 'GP-');

  insert into public.gate_passes (
    organization_id, company_id, pass_no, pass_date, party_id, warehouse_id,
    manufacturer, vehicle_no, transporter, po_no, bilty_no, remarks,
    status, created_by
  ) values (
    v_org_id, v_company_id, v_no,
    coalesce((p_payload->>'pass_date')::date, current_date),
    nullif(p_payload->>'party_id','')::uuid,
    nullif(p_payload->>'warehouse_id','')::uuid,
    nullif(p_payload->>'manufacturer',''),
    nullif(p_payload->>'vehicle_no',''),
    nullif(p_payload->>'transporter',''),
    nullif(p_payload->>'po_no',''),
    nullif(p_payload->>'bilty_no',''),
    nullif(p_payload->>'remarks',''),
    'posted', auth.uid()
  ) returning id into v_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    insert into public.gate_pass_items (
      gate_pass_id, company_id, product_id, product_code, product_name, qty, sort_order
    ) values (
      v_id, v_company_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_code',
      v_item->>'product_name',
      greatest(0, coalesce((v_item->>'qty')::numeric, 0)),
      v_idx
    );
    v_idx := v_idx + 1;
  end loop;

  return v_id;
end;
$function$;

grant execute on function public.create_gate_pass(jsonb) to authenticated, service_role;
grant execute on function public.next_document_no(uuid, doc_series_type, text) to authenticated, service_role;
