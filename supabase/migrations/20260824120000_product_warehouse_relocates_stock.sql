-- Relocate a product's on-hand stock when its default warehouse changes.
--
-- Why: the sale invoice screen, stock report, and field sale all decide "where
-- a product is" by reading stock_balances (qty per warehouse), NOT the product's
-- default_warehouse_id pointer. Previously update_product only moved the pointer,
-- so after editing a product's warehouse the stock stayed in the old warehouse and
-- every stock-driven screen kept showing / auto-picking the old one. By moving the
-- book stock to the new warehouse here, all those screens sync automatically.

CREATE OR REPLACE FUNCTION public.update_product(p_id UUID, p_payload JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_old_opening NUMERIC;
  v_old_warehouse UUID;
  v_new_opening NUMERIC;
  v_new_warehouse UUID;
  v_delta NUMERIC;
  v_stock_wh UUID;
  v_warehouse_changed BOOLEAN;
  v_onhand_old NUMERIC;
BEGIN
  SELECT company_id, opening_qty, default_warehouse_id
    INTO v_company_id, v_old_opening, v_old_warehouse
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

  UPDATE public.products SET
    name_en = COALESCE(NULLIF(trim(p_payload->>'name_en'),''), name_en),
    name_ur = CASE WHEN p_payload ? 'name_ur' THEN NULLIF(trim(COALESCE(p_payload->>'name_ur','')),'') ELSE name_ur END,
    product_type = CASE WHEN p_payload ? 'product_type' THEN NULLIF(trim(COALESCE(p_payload->>'product_type','')),'') ELSE product_type END,
    manufacturer = CASE WHEN p_payload ? 'manufacturer' THEN NULLIF(trim(COALESCE(p_payload->>'manufacturer','')),'') ELSE manufacturer END,
    category_group = CASE WHEN p_payload ? 'category_group' THEN NULLIF(trim(COALESCE(p_payload->>'category_group','')),'') ELSE category_group END,
    barcode = CASE WHEN p_payload ? 'barcode' THEN NULLIF(trim(COALESCE(p_payload->>'barcode','')),'') ELSE barcode END,
    default_warehouse_id = CASE WHEN p_payload ? 'default_warehouse_id' THEN v_new_warehouse ELSE default_warehouse_id END,
    retail_rate = COALESCE((p_payload->>'retail_rate')::NUMERIC, retail_rate),
    purchase_rate = COALESCE((p_payload->>'purchase_rate')::NUMERIC, purchase_rate),
    wholesale_rate = COALESCE((p_payload->>'wholesale_rate')::NUMERIC, wholesale_rate),
    sale_rate = COALESCE((p_payload->>'sale_rate')::NUMERIC, sale_rate),
    print_rate = COALESCE((p_payload->>'print_rate')::NUMERIC, print_rate),
    opening_rate = COALESCE((p_payload->>'opening_rate')::NUMERIC, opening_rate),
    opening_qty = v_new_opening,
    reorder_level = COALESCE((p_payload->>'reorder_level')::NUMERIC, reorder_level),
    packing = COALESCE((p_payload->>'packing')::NUMERIC, packing),
    scheme = CASE WHEN p_payload ? 'scheme' THEN NULLIF(trim(COALESCE(p_payload->>'scheme','')),'') ELSE scheme END,
    updated_at = now()
  WHERE id = p_id;

  -- Did the product's home warehouse actually move between two real warehouses?
  v_warehouse_changed := v_old_warehouse IS NOT NULL
    AND v_new_warehouse IS NOT NULL
    AND v_new_warehouse IS DISTINCT FROM v_old_warehouse;

  -- Move the product's current on-hand balance from the old warehouse to the new
  -- one so book stock follows the pointer everywhere. Two adjustment movements
  -- keep an auditable trail (out of old, into new). allow_negative := true because
  -- we shift exactly the recorded balance (old ends at 0) and must faithfully carry
  -- any pre-existing negative balance rather than block the edit.
  IF v_warehouse_changed THEN
    SELECT COALESCE(qty, 0) INTO v_onhand_old
    FROM public.stock_balances
    WHERE company_id = v_company_id
      AND warehouse_id = v_old_warehouse
      AND product_id = p_id;

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

  -- Apply any opening-qty change. When the warehouse moved, the product now lives
  -- in the new warehouse, so the delta lands there; otherwise it stays put.
  v_delta := v_new_opening - COALESCE(v_old_opening, 0);
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
$$;

REVOKE ALL ON FUNCTION public.update_product(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_product(UUID, JSONB) TO authenticated;
