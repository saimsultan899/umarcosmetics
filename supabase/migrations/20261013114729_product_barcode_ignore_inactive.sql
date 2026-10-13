-- A deleted or hidden product must not keep its barcode.
-- Active products still cannot share a barcode.

DROP INDEX IF EXISTS public.products_company_barcode_uidx;

CREATE UNIQUE INDEX products_company_barcode_uidx
  ON public.products (company_id, lower(trim(barcode)))
  WHERE is_active
    AND barcode IS NOT NULL
    AND trim(barcode) <> '';

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

  IF v_barcode ~ '^\+?\d[\d\s().-]{6,}$' AND v_barcode !~ '^\d{8,14}$' THEN
    RAISE EXCEPTION
      'Barcode looks like a phone number (%). Enter a product barcode instead.',
      v_barcode;
  END IF;

  SELECT p.code, p.name_en
    INTO v_other_code, v_other_name
  FROM public.products p
  WHERE p.company_id = p_company_id
    AND p.is_active
    AND (p_product_id IS NULL OR p.id <> p_product_id)
    AND (
      (p.barcode IS NOT NULL AND lower(trim(p.barcode)) = lower(v_barcode))
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(coalesce(p.extra_barcodes, '[]'::jsonb)) e
        WHERE lower(trim(coalesce(e->>'barcode', ''))) = lower(v_barcode)
      )
    )
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Barcode % is already used by product % — %. Use a different barcode.',
      v_barcode, v_other_code, v_other_name;
  END IF;

  SELECT p.code, p.name_en
    INTO v_other_code, v_other_name
  FROM public.products p
  WHERE p.company_id = p_company_id
    AND p.is_active
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
