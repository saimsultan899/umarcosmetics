-- Prevent barcode mess: unique per company, not equal to any product code,
-- and reject phone-number style values. Enforced in create/update RPCs + index.

-- Normalize empty barcodes to null so uniqueness ignores blanks.
UPDATE public.products
SET barcode = NULL
WHERE barcode IS NOT NULL AND trim(barcode) = '';

-- Drop leftover "code typed as barcode" rows company-wide (safe cleanup).
UPDATE public.products
SET barcode = NULL
WHERE barcode IS NOT NULL
  AND trim(barcode) = trim(code);

-- Clear shared barcodes company-wide (same barcode on 2+ products).
WITH shared AS (
  SELECT company_id, lower(trim(barcode)) AS barcode_key
  FROM public.products
  WHERE coalesce(trim(barcode), '') <> ''
  GROUP BY company_id, lower(trim(barcode))
  HAVING count(*) > 1
)
UPDATE public.products p
SET barcode = NULL
FROM shared s
WHERE p.company_id = s.company_id
  AND lower(trim(p.barcode)) = s.barcode_key;

CREATE UNIQUE INDEX IF NOT EXISTS products_company_barcode_uidx
  ON public.products (company_id, lower(trim(barcode)))
  WHERE barcode IS NOT NULL AND trim(barcode) <> '';

CREATE OR REPLACE FUNCTION private.assert_product_barcode_ok(
  p_company_id uuid,
  p_product_id uuid,
  p_code text,
  p_barcode text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_barcode text := nullif(trim(coalesce(p_barcode, '')), '');
  v_code text := trim(coalesce(p_code, ''));
  v_other_code text;
  v_other_name text;
BEGIN
  IF v_barcode IS NULL THEN
    RETURN;
  END IF;

  IF v_code <> '' AND lower(v_barcode) = lower(v_code) THEN
    RAISE EXCEPTION
      'Barcode cannot be the same as the product code (%). Scan the real barcode or leave barcode empty.',
      v_code;
  END IF;

  -- Phone numbers / WhatsApp pasted by mistake
  IF v_barcode ~ '^\+?\d[\d\s().-]{6,}$' AND v_barcode !~ '^\d{8,14}$' THEN
    RAISE EXCEPTION
      'Barcode looks like a phone number (%). Enter a product barcode instead.',
      v_barcode;
  END IF;

  -- Barcode already used by another product
  SELECT p.code, p.name_en
    INTO v_other_code, v_other_name
  FROM public.products p
  WHERE p.company_id = p_company_id
    AND p.barcode IS NOT NULL
    AND lower(trim(p.barcode)) = lower(v_barcode)
    AND (p_product_id IS NULL OR p.id <> p_product_id)
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Barcode % is already used by product % — %. Use a different barcode.',
      v_barcode, v_other_code, v_other_name;
  END IF;

  -- Barcode equals another product's item code
  SELECT p.code, p.name_en
    INTO v_other_code, v_other_name
  FROM public.products p
  WHERE p.company_id = p_company_id
    AND lower(trim(p.code)) = lower(v_barcode)
    AND (p_product_id IS NULL OR p.id <> p_product_id)
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Barcode % matches another product code (% — %). Do not put an item code in the barcode field.',
      v_barcode, v_other_code, v_other_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_product(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id UUID := (p_payload->>'company_id')::UUID;
  v_org_id UUID := (p_payload->>'organization_id')::UUID;
  v_id UUID;
  v_opening NUMERIC := COALESCE((p_payload->>'opening_qty')::NUMERIC, 0);
  v_warehouse UUID := NULLIF(p_payload->>'default_warehouse_id','')::UUID;
  v_packing NUMERIC := GREATEST(1, COALESCE((p_payload->>'packing')::NUMERIC, 1));
  v_code text := trim(p_payload->>'code');
  v_barcode text := NULLIF(trim(COALESCE(p_payload->>'barcode','')),'');
BEGIN
  IF NOT private.can_write_company(v_company_id) THEN
    RAISE EXCEPTION 'No write access';
  END IF;

  IF v_opening <> 0 AND v_warehouse IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required when opening quantity is not zero';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.company_id = v_company_id
      AND lower(trim(p.code)) = lower(v_code)
  ) THEN
    RAISE EXCEPTION 'Product code % already exists. Use a different code.', v_code;
  END IF;

  PERFORM private.assert_product_barcode_ok(v_company_id, NULL, v_code, v_barcode);

  INSERT INTO public.products (
    organization_id, company_id, code, name_en, name_ur,
    product_type, manufacturer, category_group, barcode,
    default_warehouse_id,
    retail_rate, purchase_rate, wholesale_rate, sale_rate, print_rate,
    opening_rate, opening_qty, reorder_level, packing, unit_type, base_unit, scheme,
    is_active, created_by
  ) VALUES (
    v_org_id,
    v_company_id,
    v_code,
    trim(p_payload->>'name_en'),
    NULLIF(trim(COALESCE(p_payload->>'name_ur','')),''),
    NULLIF(trim(COALESCE(p_payload->>'product_type','')),''),
    NULLIF(trim(COALESCE(p_payload->>'manufacturer','')),''),
    NULLIF(trim(COALESCE(p_payload->>'category_group','')),''),
    v_barcode,
    v_warehouse,
    COALESCE((p_payload->>'retail_rate')::NUMERIC, 0),
    COALESCE((p_payload->>'purchase_rate')::NUMERIC, 0),
    COALESCE((p_payload->>'wholesale_rate')::NUMERIC, 0),
    COALESCE((p_payload->>'sale_rate')::NUMERIC, 0),
    COALESCE((p_payload->>'print_rate')::NUMERIC, 0),
    COALESCE((p_payload->>'opening_rate')::NUMERIC, 0),
    v_opening,
    COALESCE((p_payload->>'reorder_level')::NUMERIC, 0),
    v_packing,
    COALESCE(NULLIF(trim(COALESCE(p_payload->>'unit_type','')),''), CASE WHEN v_packing > 1 THEN 'Carton' ELSE 'Piece' END),
    COALESCE(NULLIF(trim(COALESCE(p_payload->>'base_unit','')),''), 'Piece'),
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

CREATE OR REPLACE FUNCTION public.update_product(p_id uuid, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id UUID;
  v_old_opening NUMERIC;
  v_old_warehouse UUID;
  v_old_code text;
  v_new_opening NUMERIC;
  v_new_warehouse UUID;
  v_delta NUMERIC;
  v_stock_wh UUID;
  v_warehouse_changed BOOLEAN;
  v_onhand_old NUMERIC;
  v_barcode text;
BEGIN
  SELECT company_id, opening_qty, default_warehouse_id, code
    INTO v_company_id, v_old_opening, v_old_warehouse, v_old_code
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

  IF p_payload ? 'barcode' THEN
    v_barcode := NULLIF(trim(COALESCE(p_payload->>'barcode','')),'');
    PERFORM private.assert_product_barcode_ok(
      v_company_id,
      p_id,
      v_old_code,
      v_barcode
    );
  END IF;

  UPDATE public.products SET
    name_en = COALESCE(NULLIF(trim(p_payload->>'name_en'),''), name_en),
    name_ur = CASE WHEN p_payload ? 'name_ur' THEN NULLIF(trim(COALESCE(p_payload->>'name_ur','')),'') ELSE name_ur END,
    product_type = CASE WHEN p_payload ? 'product_type' THEN NULLIF(trim(COALESCE(p_payload->>'product_type','')),'') ELSE product_type END,
    manufacturer = CASE WHEN p_payload ? 'manufacturer' THEN NULLIF(trim(COALESCE(p_payload->>'manufacturer','')),'') ELSE manufacturer END,
    category_group = CASE WHEN p_payload ? 'category_group' THEN NULLIF(trim(COALESCE(p_payload->>'category_group','')),'') ELSE category_group END,
    barcode = CASE WHEN p_payload ? 'barcode' THEN v_barcode ELSE barcode END,
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

REVOKE ALL ON FUNCTION public.create_product(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_product(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_product(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_product(uuid, jsonb) TO authenticated, service_role;
