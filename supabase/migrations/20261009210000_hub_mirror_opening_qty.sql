-- Mirror products.opening_qty across hub-linked companies so Opening Qty
-- set on the main company (Imran) shows on Ishaq / Umar product forms.
-- Stock already lives on main via resolve_shared_stock_target; this keeps
-- the Opening Qty field aligned and prevents spoke edits from double-stocking.

CREATE OR REPLACE FUNCTION private.sync_product_master_fields(
  p_from_id uuid,
  p_to_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_from public.products%rowtype;
  v_to_company uuid;
  v_hub_wh uuid;
BEGIN
  IF p_from_id IS NULL OR p_to_id IS NULL OR p_from_id = p_to_id THEN
    RETURN;
  END IF;

  SELECT * INTO v_from FROM public.products WHERE id = p_from_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT company_id INTO v_to_company FROM public.products WHERE id = p_to_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_hub_wh := private.ensure_hub_warehouse(v_from.default_warehouse_id, v_to_company);

  UPDATE public.products SET
    name_en = v_from.name_en,
    name_ur = v_from.name_ur,
    product_type = v_from.product_type,
    manufacturer = v_from.manufacturer,
    category_group = v_from.category_group,
    barcode = CASE
      WHEN v_from.barcode IS NULL THEN barcode
      WHEN EXISTS (
        SELECT 1 FROM public.products x
        WHERE x.company_id = v_to_company
          AND x.id <> p_to_id
          AND x.barcode IS NOT NULL
          AND lower(trim(x.barcode)) = lower(trim(v_from.barcode))
      ) THEN barcode
      ELSE v_from.barcode
    END,
    extra_barcodes = coalesce(v_from.extra_barcodes, '[]'::jsonb),
    default_warehouse_id = coalesce(v_hub_wh, default_warehouse_id),
    retail_rate = v_from.retail_rate,
    purchase_rate = v_from.purchase_rate,
    wholesale_rate = v_from.wholesale_rate,
    sale_rate = v_from.sale_rate,
    print_rate = v_from.print_rate,
    opening_rate = v_from.opening_rate,
    opening_qty = v_from.opening_qty,
    reorder_level = v_from.reorder_level,
    packing = v_from.packing,
    unit_type = v_from.unit_type,
    base_unit = v_from.base_unit,
    scheme = v_from.scheme,
    is_active = v_from.is_active,
    updated_at = now()
  WHERE id = p_to_id;
END;
$function$;

DROP TRIGGER IF EXISTS products_mirror_hub ON public.products;
CREATE TRIGGER products_mirror_hub
  AFTER INSERT OR UPDATE OF
    name_en, name_ur, product_type, manufacturer, category_group,
    barcode, extra_barcodes, default_warehouse_id,
    retail_rate, purchase_rate, wholesale_rate, sale_rate, print_rate,
    opening_rate, opening_qty, reorder_level, packing, unit_type, base_unit, scheme, is_active
  ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_mirror_product_to_hub();

-- Spoke opening edits: baseline delta against hub opening_qty so matching
-- Imran's value does not double-apply stock on main.
CREATE OR REPLACE FUNCTION public.update_product(p_id uuid, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_old_opening NUMERIC;
  v_old_warehouse UUID;
  v_old_code text;
  v_old_barcode text;
  v_old_extra jsonb;
  v_hub_product_id uuid;
  v_new_opening NUMERIC;
  v_new_warehouse UUID;
  v_delta NUMERIC;
  v_stock_wh UUID;
  v_warehouse_changed BOOLEAN;
  v_onhand_old NUMERIC;
  v_barcode text;
  v_extra jsonb;
  v_touch_barcodes boolean := false;
  v_baseline_opening NUMERIC;
BEGIN
  SELECT company_id, opening_qty, default_warehouse_id, code, barcode, extra_barcodes, hub_product_id
    INTO v_company_id, v_old_opening, v_old_warehouse, v_old_code, v_old_barcode, v_old_extra, v_hub_product_id
  FROM public.products
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  IF NOT private.can_write_company(v_company_id) THEN
    RAISE EXCEPTION 'No write access';
  END IF;

  v_new_opening := COALESCE((p_payload->>'opening_qty')::NUMERIC, v_old_opening);
  v_new_warehouse := COALESCE(
    NULLIF(p_payload->>'default_warehouse_id','')::UUID,
    v_old_warehouse
  );

  IF v_new_opening <> 0 AND v_new_warehouse IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required when opening quantity is not zero';
  END IF;

  v_barcode := v_old_barcode;
  v_extra := coalesce(v_old_extra, '[]'::jsonb);

  IF p_payload ? 'extra_barcodes' OR p_payload ? 'barcode' THEN
    v_touch_barcodes := true;
    SELECT b.barcode, b.extra_barcodes
      INTO v_barcode, v_extra
    FROM private.prepare_product_barcodes(
      v_company_id,
      p_id,
      v_old_code,
      CASE
        WHEN p_payload ? 'barcode' THEN NULLIF(trim(COALESCE(p_payload->>'barcode','')),'')
        ELSE v_old_barcode
      END,
      CASE
        WHEN p_payload ? 'extra_barcodes' THEN p_payload->'extra_barcodes'
        ELSE v_old_extra
      END,
      p_payload ? 'extra_barcodes'
    ) b;
  END IF;

  UPDATE public.products SET
    name_en = COALESCE(NULLIF(trim(p_payload->>'name_en'),''), name_en),
    name_ur = CASE WHEN p_payload ? 'name_ur' THEN NULLIF(trim(COALESCE(p_payload->>'name_ur','')),'') ELSE name_ur END,
    product_type = CASE WHEN p_payload ? 'product_type' THEN NULLIF(trim(COALESCE(p_payload->>'product_type','')),'') ELSE product_type END,
    manufacturer = CASE WHEN p_payload ? 'manufacturer' THEN NULLIF(trim(COALESCE(p_payload->>'manufacturer','')),'') ELSE manufacturer END,
    category_group = CASE WHEN p_payload ? 'category_group' THEN NULLIF(trim(COALESCE(p_payload->>'category_group','')),'') ELSE category_group END,
    barcode = CASE WHEN v_touch_barcodes THEN v_barcode ELSE barcode END,
    extra_barcodes = CASE WHEN v_touch_barcodes THEN coalesce(v_extra, '[]'::jsonb) ELSE extra_barcodes END,
    default_warehouse_id = CASE WHEN p_payload ? 'default_warehouse_id' THEN v_new_warehouse ELSE default_warehouse_id END,
    retail_rate = COALESCE((p_payload->>'retail_rate')::NUMERIC, retail_rate),
    purchase_rate = COALESCE((p_payload->>'purchase_rate')::NUMERIC, purchase_rate),
    wholesale_rate = COALESCE((p_payload->>'wholesale_rate')::NUMERIC, wholesale_rate),
    sale_rate = COALESCE((p_payload->>'sale_rate')::NUMERIC, sale_rate),
    print_rate = COALESCE((p_payload->>'print_rate')::NUMERIC, print_rate),
    opening_rate = COALESCE((p_payload->>'opening_rate')::NUMERIC, opening_rate),
    opening_qty = v_new_opening,
    reorder_level = COALESCE((p_payload->>'reorder_level')::NUMERIC, reorder_level),
    packing = GREATEST(1, COALESCE((p_payload->>'packing')::NUMERIC, packing)),
    unit_type = CASE WHEN p_payload ? 'unit_type' THEN COALESCE(NULLIF(trim(COALESCE(p_payload->>'unit_type','')),''), unit_type) ELSE unit_type END,
    base_unit = CASE WHEN p_payload ? 'base_unit' THEN COALESCE(NULLIF(trim(COALESCE(p_payload->>'base_unit','')),''), base_unit) ELSE base_unit END,
    scheme = CASE WHEN p_payload ? 'scheme' THEN NULLIF(trim(COALESCE(p_payload->>'scheme','')),'') ELSE scheme END,
    updated_at = now()
  WHERE id = p_id;

  v_warehouse_changed := v_old_warehouse IS NOT NULL
    AND v_new_warehouse IS NOT NULL
    AND v_new_warehouse IS DISTINCT FROM v_old_warehouse;

  IF v_warehouse_changed THEN
    SELECT COALESCE(qty, 0) INTO v_onhand_old
    FROM public.stock_balances
    WHERE company_id = v_company_id
      AND warehouse_id = v_old_warehouse
      AND product_id = p_id;

    IF coalesce(v_onhand_old, 0) = 0 AND v_hub_product_id IS NOT NULL THEN
      v_onhand_old := private.shared_stock_on_hand(v_company_id, v_old_warehouse, p_id);
    END IF;

    IF COALESCE(v_onhand_old, 0) <> 0 THEN
      PERFORM private.apply_stock_delta(
        v_company_id, v_old_warehouse, p_id, -v_onhand_old,
        'adjustment', 'products', p_id, true
      );
      PERFORM private.apply_stock_delta(
        v_company_id, v_new_warehouse, p_id, v_onhand_old,
        'adjustment', 'products', p_id, true
      );
    END IF;
  END IF;

  v_baseline_opening := v_old_opening;
  IF v_hub_product_id IS NOT NULL THEN
    SELECT opening_qty INTO v_baseline_opening
    FROM public.products WHERE id = v_hub_product_id;
    v_baseline_opening := coalesce(v_baseline_opening, v_old_opening, 0);
  END IF;

  v_delta := v_new_opening - COALESCE(v_baseline_opening, 0);
  IF v_delta <> 0 THEN
    v_stock_wh := CASE
      WHEN v_warehouse_changed THEN v_new_warehouse
      ELSE COALESCE(v_old_warehouse, v_new_warehouse)
    END;
    IF v_stock_wh IS NULL THEN
      RAISE EXCEPTION 'Warehouse is required to adjust opening stock';
    END IF;
    PERFORM private.apply_stock_delta(
      v_company_id, v_stock_wh, p_id, v_delta,
      'adjustment', 'products', p_id, true
    );
  END IF;

  RETURN p_id;
END;
$function$;

DO $backfill$
BEGIN
  PERFORM private.set_hub_mirroring(true);
  UPDATE public.products sp
  SET opening_qty = hp.opening_qty,
      opening_rate = hp.opening_rate,
      updated_at = now()
  FROM public.products hp
  WHERE sp.hub_product_id = hp.id
    AND (
      sp.opening_qty IS DISTINCT FROM hp.opening_qty
      OR sp.opening_rate IS DISTINCT FROM hp.opening_rate
    );
  PERFORM private.set_hub_mirroring(false);
END;
$backfill$;
