-- Product create/update RPCs that seed/adjust stock_balances from opening_qty

CREATE OR REPLACE FUNCTION public.create_product(p_payload JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID := (p_payload->>'company_id')::UUID;
  v_org_id UUID := (p_payload->>'organization_id')::UUID;
  v_id UUID;
  v_opening NUMERIC := COALESCE((p_payload->>'opening_qty')::NUMERIC, 0);
  v_warehouse UUID := NULLIF(p_payload->>'default_warehouse_id','')::UUID;
BEGIN
  IF NOT private.can_write_company(v_company_id) THEN
    RAISE EXCEPTION 'No write access';
  END IF;

  IF v_opening <> 0 AND v_warehouse IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required when opening quantity is not zero';
  END IF;

  INSERT INTO public.products (
    organization_id, company_id, code, name_en, name_ur,
    product_type, manufacturer, category_group, barcode,
    default_warehouse_id,
    retail_rate, purchase_rate, wholesale_rate, sale_rate, print_rate,
    opening_rate, opening_qty, reorder_level, packing, scheme,
    is_active, created_by
  ) VALUES (
    v_org_id,
    v_company_id,
    trim(p_payload->>'code'),
    trim(p_payload->>'name_en'),
    NULLIF(trim(COALESCE(p_payload->>'name_ur','')),''),
    NULLIF(trim(COALESCE(p_payload->>'product_type','')),''),
    NULLIF(trim(COALESCE(p_payload->>'manufacturer','')),''),
    NULLIF(trim(COALESCE(p_payload->>'category_group','')),''),
    NULLIF(trim(COALESCE(p_payload->>'barcode','')),''),
    v_warehouse,
    COALESCE((p_payload->>'retail_rate')::NUMERIC, 0),
    COALESCE((p_payload->>'purchase_rate')::NUMERIC, 0),
    COALESCE((p_payload->>'wholesale_rate')::NUMERIC, 0),
    COALESCE((p_payload->>'sale_rate')::NUMERIC, 0),
    COALESCE((p_payload->>'print_rate')::NUMERIC, 0),
    COALESCE((p_payload->>'opening_rate')::NUMERIC, 0),
    v_opening,
    COALESCE((p_payload->>'reorder_level')::NUMERIC, 0),
    COALESCE((p_payload->>'packing')::NUMERIC, 1),
    NULLIF(trim(COALESCE(p_payload->>'scheme','')),''),
    COALESCE((p_payload->>'is_active')::BOOLEAN, true),
    auth.uid()
  )
  RETURNING id INTO v_id;

  IF v_opening <> 0 THEN
    PERFORM private.apply_stock_delta(
      v_company_id, v_warehouse, v_id, v_opening,
      'adjustment', 'products', v_id, true
    );
  END IF;

  RETURN v_id;
END;
$$;

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

  v_delta := v_new_opening - COALESCE(v_old_opening, 0);
  IF v_delta <> 0 THEN
    v_stock_wh := COALESCE(v_old_warehouse, v_new_warehouse);
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

REVOKE ALL ON FUNCTION public.create_product(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_product(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_product(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_product(UUID, JSONB) TO authenticated;

-- Backfill opening stock for products that never seeded stock_balances
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.id, p.company_id, p.default_warehouse_id, p.opening_qty
    FROM public.products p
    WHERE COALESCE(p.opening_qty, 0) <> 0
      AND p.default_warehouse_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.stock_movements m
        WHERE m.ref_table = 'products'
          AND m.ref_id = p.id
          AND m.move_type = 'adjustment'
      )
  LOOP
    PERFORM private.apply_stock_delta(
      r.company_id, r.default_warehouse_id, r.id, r.opening_qty,
      'adjustment', 'products', r.id, true
    );
  END LOOP;
END;
$$;
