-- One stock position for a hub group (Imran / Ishaq / Umar).
-- Each company keeps its own invoices and ledgers.
-- Any stock move is written on the main company, then that qty is copied
-- onto each sister product linked by hub_product_id (same warehouse name).
-- Purchases must not be added twice: apply_stock_delta already lands on main,
-- so apply_hub_purchase_stock does nothing.
-- A sister product that does not exist on the main company keeps its own qty.
-- We do not create a zero hub row and then copy that back over the sister.

CREATE OR REPLACE FUNCTION private.product_shares_hub_stock(p_product_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prod public.products%ROWTYPE;
  v_main uuid;
BEGIN
  IF p_product_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_prod FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_main := private.org_main_company_id(v_prod.company_id);
  IF v_main IS NULL THEN
    RETURN false;
  END IF;

  IF v_prod.company_id = v_main OR v_prod.hub_product_id IS NOT NULL THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.products h
    WHERE h.company_id = v_main
      AND lower(trim(h.code)) = lower(trim(v_prod.code))
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.ensure_spoke_product_copies(p_hub_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hub public.products%ROWTYPE;
  v_main uuid;
  v_org uuid;
  v_wh_name text;
  v_flag boolean;
  v_sister uuid;
  v_spoke uuid;
  v_spoke_wh uuid;
BEGIN
  IF p_hub_product_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_hub FROM public.products WHERE id = p_hub_product_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_main := private.org_main_company_id(v_hub.company_id);
  IF v_main IS NULL OR v_hub.company_id <> v_main THEN
    RETURN;
  END IF;

  SELECT organization_id INTO v_org FROM public.companies WHERE id = v_main;
  SELECT name INTO v_wh_name
  FROM public.warehouses
  WHERE id = v_hub.default_warehouse_id;

  v_flag := private.hub_mirroring();
  IF NOT v_flag THEN
    PERFORM private.set_hub_mirroring(true);
  END IF;

  FOR v_sister IN
    SELECT c.id
    FROM public.companies c
    WHERE c.organization_id = v_org
      AND c.id <> v_main
  LOOP
    v_spoke := NULL;
    v_spoke_wh := NULL;

    SELECT id INTO v_spoke
    FROM public.products
    WHERE company_id = v_sister
      AND hub_product_id = v_hub.id
    LIMIT 1;

    IF v_spoke IS NULL THEN
      SELECT id INTO v_spoke
      FROM public.products
      WHERE company_id = v_sister
        AND lower(trim(code)) = lower(trim(v_hub.code))
      LIMIT 1;
    END IF;

    IF v_wh_name IS NOT NULL THEN
      SELECT id INTO v_spoke_wh
      FROM public.warehouses
      WHERE company_id = v_sister
        AND lower(trim(name)) = lower(trim(v_wh_name))
      LIMIT 1;
    END IF;

    IF v_spoke IS NOT NULL THEN
      UPDATE public.products
      SET hub_product_id = v_hub.id
      WHERE id = v_spoke
        AND hub_product_id IS NULL;
      CONTINUE;
    END IF;

    -- Sister does not stock this warehouse yet. Do not invent one.
    IF v_hub.default_warehouse_id IS NOT NULL AND v_spoke_wh IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.products (
      organization_id, company_id, code, name_en, name_ur,
      product_type, manufacturer, category_group, barcode, extra_barcodes,
      default_warehouse_id,
      retail_rate, purchase_rate, wholesale_rate, sale_rate, print_rate,
      opening_rate, opening_qty, reorder_level, packing, unit_type, base_unit, scheme,
      is_active, created_by, hub_product_id
    ) VALUES (
      v_org, v_sister, v_hub.code, v_hub.name_en, v_hub.name_ur,
      v_hub.product_type, v_hub.manufacturer, v_hub.category_group,
      CASE
        WHEN v_hub.barcode IS NULL THEN NULL
        WHEN EXISTS (
          SELECT 1 FROM public.products x
          WHERE x.company_id = v_sister
            AND x.barcode IS NOT NULL
            AND lower(trim(x.barcode)) = lower(trim(v_hub.barcode))
        ) THEN NULL
        ELSE v_hub.barcode
      END,
      coalesce(v_hub.extra_barcodes, '[]'::jsonb),
      v_spoke_wh,
      v_hub.retail_rate, v_hub.purchase_rate, v_hub.wholesale_rate, v_hub.sale_rate, v_hub.print_rate,
      v_hub.opening_rate, coalesce(v_hub.opening_qty, 0), v_hub.reorder_level,
      v_hub.packing, v_hub.unit_type, v_hub.base_unit, v_hub.scheme,
      v_hub.is_active, auth.uid(), v_hub.id
    );
  END LOOP;

  IF NOT v_flag THEN
    PERFORM private.set_hub_mirroring(false);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION private.mirror_shared_stock_qty(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_product_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_main uuid;
  v_qty numeric;
  v_wh_name text;
  r record;
  v_spoke_wh uuid;
BEGIN
  IF p_company_id IS NULL OR p_warehouse_id IS NULL OR p_product_id IS NULL THEN
    RETURN;
  END IF;

  v_main := private.org_main_company_id(p_company_id);
  IF v_main IS NULL OR p_company_id <> v_main THEN
    RETURN;
  END IF;

  SELECT coalesce(sb.qty, 0) INTO v_qty
  FROM public.stock_balances sb
  WHERE sb.company_id = p_company_id
    AND sb.warehouse_id = p_warehouse_id
    AND sb.product_id = p_product_id;
  v_qty := coalesce(v_qty, 0);

  SELECT name INTO v_wh_name FROM public.warehouses WHERE id = p_warehouse_id;
  IF v_wh_name IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT p.id, p.company_id
    FROM public.products p
    WHERE p.hub_product_id = p_product_id
      AND p.company_id <> p_company_id
  LOOP
    SELECT id INTO v_spoke_wh
    FROM public.warehouses
    WHERE company_id = r.company_id
      AND lower(trim(name)) = lower(trim(v_wh_name))
    LIMIT 1;

    IF v_spoke_wh IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.stock_balances (company_id, warehouse_id, product_id, qty)
    VALUES (r.company_id, v_spoke_wh, r.id, v_qty)
    ON CONFLICT (company_id, warehouse_id, product_id)
    DO UPDATE SET qty = EXCLUDED.qty, updated_at = now();
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION private.mirror_product_to_hub(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_src public.products%ROWTYPE;
  v_main uuid;
  v_hub uuid;
  r record;
BEGIN
  IF p_product_id IS NULL OR private.hub_mirroring() THEN
    RETURN;
  END IF;

  SELECT * INTO v_src FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_main := private.org_main_company_id(v_src.company_id);
  IF v_main IS NULL THEN RETURN; END IF;

  IF v_src.company_id = v_main THEN
    PERFORM private.set_hub_mirroring(true);
    FOR r IN
      SELECT id FROM public.products
      WHERE hub_product_id = v_src.id
        AND company_id <> v_main
    LOOP
      PERFORM private.sync_product_master_fields(v_src.id, r.id);
    END LOOP;
    PERFORM private.ensure_spoke_product_copies(v_src.id);
    PERFORM private.set_hub_mirroring(false);
    RETURN;
  END IF;

  v_hub := private.ensure_hub_product(v_src.id);
  IF v_hub IS NULL THEN RETURN; END IF;

  PERFORM private.set_hub_mirroring(true);
  PERFORM private.sync_product_master_fields(v_src.id, v_hub);
  PERFORM private.set_hub_mirroring(false);
END;
$function$;

CREATE OR REPLACE FUNCTION private.apply_stock_delta(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_product_id uuid,
  p_qty_delta numeric,
  p_move_type stock_move_type,
  p_ref_table text,
  p_ref_id uuid,
  p_allow_negative boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_target record;
  v_company uuid;
  v_warehouse uuid;
  v_product uuid;
  v_qty numeric;
  v_product_label text;
  v_warehouse_label text;
BEGIN
  IF private.product_shares_hub_stock(p_product_id) THEN
    SELECT * INTO v_target
    FROM private.resolve_shared_stock_target(p_company_id, p_warehouse_id, p_product_id);
    v_company := coalesce(v_target.company_id, p_company_id);
    v_warehouse := coalesce(v_target.warehouse_id, p_warehouse_id);
    v_product := coalesce(v_target.product_id, p_product_id);
  ELSE
    v_company := p_company_id;
    v_warehouse := p_warehouse_id;
    v_product := p_product_id;
  END IF;

  INSERT INTO public.stock_balances (company_id, warehouse_id, product_id, qty)
  VALUES (v_company, v_warehouse, v_product, 0)
  ON CONFLICT (company_id, warehouse_id, product_id) DO NOTHING;

  UPDATE public.stock_balances
  SET qty = qty + p_qty_delta,
      updated_at = now()
  WHERE company_id = v_company
    AND warehouse_id = v_warehouse
    AND product_id = v_product
  RETURNING qty INTO v_qty;

  IF NOT p_allow_negative AND v_qty < 0 THEN
    SELECT coalesce(nullif(trim(code), '') || ' — ', '') || coalesce(nullif(trim(name_en), ''), 'Unknown product')
      INTO v_product_label
    FROM public.products
    WHERE id = v_product;

    SELECT coalesce(nullif(trim(name), ''), 'Unknown warehouse')
      INTO v_warehouse_label
    FROM public.warehouses
    WHERE id = v_warehouse;

    RAISE EXCEPTION
      'Insufficient stock for product % in warehouse % (available % after this move)',
      coalesce(v_product_label, v_product::text),
      coalesce(v_warehouse_label, v_warehouse::text),
      coalesce(v_qty - p_qty_delta, 0);
  END IF;

  INSERT INTO public.stock_movements (
    company_id, warehouse_id, product_id, move_type, qty, ref_table, ref_id, created_by
  ) VALUES (
    v_company, v_warehouse, v_product, p_move_type, p_qty_delta, p_ref_table, p_ref_id, auth.uid()
  );

  PERFORM private.mirror_shared_stock_qty(v_company, v_warehouse, v_product);
END;
$function$;

CREATE OR REPLACE FUNCTION private.shared_stock_on_hand(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_product_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_target record;
  v_qty numeric;
BEGIN
  IF NOT private.product_shares_hub_stock(p_product_id) THEN
    SELECT coalesce(sb.qty, 0) INTO v_qty
    FROM public.stock_balances sb
    WHERE sb.company_id = p_company_id
      AND sb.warehouse_id = p_warehouse_id
      AND sb.product_id = p_product_id;
    RETURN coalesce(v_qty, 0);
  END IF;

  SELECT * INTO v_target
  FROM private.resolve_shared_stock_target(p_company_id, p_warehouse_id, p_product_id);

  IF v_target.warehouse_id IS NULL OR v_target.product_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT coalesce(sb.qty, 0) INTO v_qty
  FROM public.stock_balances sb
  WHERE sb.company_id = v_target.company_id
    AND sb.warehouse_id = v_target.warehouse_id
    AND sb.product_id = v_target.product_id;

  RETURN coalesce(v_qty, 0);
END;
$function$;

-- Spoke purchases already reach main through apply_stock_delta.
CREATE OR REPLACE FUNCTION private.apply_hub_purchase_stock(
  p_spoke_company_id uuid,
  p_spoke_warehouse_id uuid,
  p_spoke_product_id uuid,
  p_qty numeric,
  p_ref_table text,
  p_ref_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN;
END;
$function$;

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

    v_on_hand := private.shared_stock_on_hand(v_company_id, v_stock_wh, v_product_id);

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

DO $backfill$
DECLARE
  r record;
  b record;
BEGIN
  PERFORM private.set_hub_mirroring(true);
  FOR r IN
    SELECT p.id
    FROM public.products p
    JOIN public.companies c ON c.id = p.company_id
    JOIN public.organizations o ON o.id = c.organization_id
    WHERE o.main_company_id = p.company_id
  LOOP
    PERFORM private.ensure_spoke_product_copies(r.id);
  END LOOP;
  PERFORM private.set_hub_mirroring(false);

  FOR b IN
    SELECT sb.company_id, sb.warehouse_id, sb.product_id
    FROM public.stock_balances sb
    JOIN public.companies c ON c.id = sb.company_id
    JOIN public.organizations o ON o.id = c.organization_id
    WHERE o.main_company_id = sb.company_id
  LOOP
    PERFORM private.mirror_shared_stock_qty(b.company_id, b.warehouse_id, b.product_id);
  END LOOP;
END;
$backfill$;
