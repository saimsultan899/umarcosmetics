-- Restore Imran Traders SWEET FACE rate-list products (95 S/F items)
-- accidentally deleted. Copy rates/packing/etc from Umar (preferred) or Ishaq,
-- fall back to original seed TP. Copy stock qty from source balances when present.
-- Re-link Ishaq / Umar Cosmetic copies via hub_product_id.

DO $$
DECLARE
  v_org uuid;
  v_imran uuid;
  v_imran_wh uuid;
  v_max_code bigint;
  v_ord int;
  v_name text;
  v_tp numeric;
  v_src public.products%rowtype;
  v_new_id uuid;
  v_code text;
  v_qty numeric;
  r record;
BEGIN
  SELECT c.organization_id, c.id, w.id
  INTO v_org, v_imran, v_imran_wh
  FROM public.companies c
  JOIN public.warehouses w
    ON w.company_id = c.id AND lower(trim(w.name)) = 'sweet face'
  WHERE c.name = 'Imran Traders';

  IF v_imran IS NULL OR v_imran_wh IS NULL THEN
    RAISE EXCEPTION 'Imran Traders SWEET FACE warehouse not found';
  END IF;

  -- Keep warehouse active (Ishaq delete may have left related state messy).
  UPDATE public.warehouses
  SET is_active = true
  WHERE id = v_imran_wh AND is_active IS DISTINCT FROM true;

  SELECT COALESCE(MAX(p.code::bigint), 0)
  INTO v_max_code
  FROM public.products p
  WHERE p.company_id = v_imran AND p.code ~ '^[0-9]+$';

  -- Suppress hub push while we insert + relink manually.
  PERFORM private.set_hub_mirroring(true);

  v_ord := 0;
  FOR r IN
    SELECT * FROM (VALUES
      (1, 'S/F ONE STEP NAIL POLISH 12ML', 165),
      (2, 'S/F GLAMOROUS LIP STICK SINGLE STROKE', 200),
      (3, 'S/F QUICK DRY NAIL POLISH 9ML', 145),
      (4, 'S/F LIP PROUD COLOR STAY LIP GLOSS', 315),
      (5, 'S/F FRENCH MENICURE SET', 0),
      (6, 'S/F NUDE LIP PROUD COLOR STAY LIP GLOSS', 315),
      (7, 'S/F NAIL POLISH REMOVER FAST & GENTLE 100ML', 185),
      (8, 'S/F LIP/EYE PENCIL', 70),
      (9, 'S/F NAIL POLISH REMOVING WIPES 40PCS', 155),
      (10, 'S/F BARBIE LIP/EYE PENCIL', 84),
      (11, 'S/F RUSH COLOR JUMBO LIP/EYE PENCIL', 115),
      (12, 'S/F PREMIUM MATTE LOOK KAJAL', 185),
      (13, 'S/F QUEEN (ULTIMATE LONG WEAR LIP COLOR)', 175),
      (14, 'S/F SPARKLING GLITTER EYE LINER', 255),
      (15, 'S/F SPARKLING 3D LIP GLOSS', 315),
      (16, 'S/F QUICK DRY PEN EYE LINER', 410),
      (17, 'S/F FANTACY LIP GLOSS', 145),
      (18, 'S/F 3D SHIMMER DUST', 190),
      (19, 'S/F 4D DIAMOND GLITTER DUST', 190),
      (20, 'S/F MATTE LOOK CONCEALER STICK', 230),
      (21, 'S/F WATER PROOF ULTRA-FINE EYE LINER', 315),
      (22, 'S/F FACE & BODY GLOW LOOSE SHINER', 410),
      (23, 'S/F WATER PROOF REAL LASH MASCARA', 315),
      (24, 'S/F W/P REAL BASE PAINT STICK', 500),
      (25, 'S/F COLOR MASCARA', 335),
      (26, 'S/F OIL FREE TWO WAY CAKE', 485),
      (27, 'S/F SPARKLING GLITTER PENCIL', 85),
      (28, 'S/F W/P FOUNDATION STICK', 185),
      (29, 'S/F W/P AQUA CAKE EYE LINER', 240),
      (30, 'S/F OIL CONTROL WHITENING PRESSED POWDER', 430),
      (31, 'S/F W/P MATTE KAJAL', 285),
      (32, 'S/F AQUA WET CAKE', 450),
      (33, 'S/F EXTREME VOLUME MASCARA', 420),
      (34, 'S/F REAL BASE OIL FREE LIQUID FOUNDATION', 845),
      (35, 'S/F DIP EYE LINER', 240),
      (36, 'S/F WHITE GLOW FACE WASH 90MLE', 170),
      (37, 'S/F W/P EYE SEALER (MULTI PURPOSE)', 205),
      (38, 'S/F WHITE GLOW FACE WASH 100ML', 221),
      (39, 'S/F PROFESSIONAL EYE-BROW PENCIL', 160),
      (40, 'S/F GENTLE WHITENING CLEANSING LOTION 150ML', 320),
      (41, 'S/F W/P KAJAL PENCIL', 85),
      (42, 'S/F PORE FILLER FACE PRIMER 30ML', 920),
      (43, 'S/F CREAM GEL EYE SHADOW', 295),
      (44, 'S/F ULTRA MATTE FACE PRIMER', 1265),
      (45, 'S/F 2 IN 1 EYE BROW POWDER & CREAMY EYE LINER', 435),
      (46, 'S/F OIL FREE LOOSE SETTING POWDER', 390),
      (47, 'S/F LIQUID EYE SHADOW (SHIMMER GLOW)', 580),
      (48, 'S/F PRO COVERAGE PAINT STICK', 1575),
      (49, 'S/F LIQUID CONCEALER MATT FINISH', 385),
      (50, 'S/F PUFF SMALL OVAL', 75),
      (51, 'S/F STAR GLITTER (FACE & BODY)', 165),
      (52, 'S/F APPLICATOR (30 PES) BOX', 285),
      (53, 'S/F MATALIC SHIMMER LIQUID HIGHLIGHT BASE', 410),
      (54, 'S/F APPLICATOR (15 PES) BOX', 170),
      (55, 'S/F TALCUM POWDER 125GM', 210),
      (56, 'S/F ROUND PUFF', 100),
      (57, 'S/F TALCUM POWDER 240GM', 335),
      (58, 'S/F SBR MAKE UP SPONGE 4 IN 1', 145),
      (59, 'S/F PUFF N BUFF 3 IN 1', 190),
      (60, 'S/F SINGLE GLOW RIGHT HIGHLIGHTER', 250),
      (61, 'S/F CLOUD PUFF BLENDER 4 IN 1', 380),
      (62, 'S/F 4 COLOR GLOWING KIT CHEEK BONE & HIGHLIGHTER', 725),
      (63, 'S/F PROFESSIONAL BLUSH ON BRUSH', 345),
      (64, 'S/F 6 COLOR 3D GLOW BAKED HIGHLIGHTER', 685),
      (65, 'S/F PROFESSIONAL SETTING POWDER BRUSH', 345),
      (66, 'S/F PROFESSIONAL CONTOUR BRUSH', 345),
      (67, 'S/F 4 COLOR NOSE & FACE CONTOURING KIT', 725),
      (68, 'S/F PROFESSIONAL FOUNDATION BRUSH', 345),
      (69, 'S/F 2 COLOR BLUSH ON', 160),
      (70, 'S/F PROFESSIONAL FAN BRUSH', 365),
      (71, 'S/F 14 COLOR TERRACOTA BLUSH ON', 685),
      (72, 'S/F 12 BASIC PROFESSIONAL BRUSH KIT', 2090),
      (73, 'S/F 6 COLOR TERRACOTA B/ON', 590),
      (74, 'S/F 24 LUXURY PROFESSIONAL BRUSH KIT', 3150),
      (75, 'S/F MUFFIN SINGLE COLOR TERRACOTTA BLUSH ON', 275),
      (76, 'S/F 4PCS EYE MAKE-UP BRUSH SET', 705),
      (77, 'S/F MATTE TOUCH SINGLE COLOR BLUSH ON', 290),
      (78, 'S/F SUPER STRONG FIX LASH GLUE', 180),
      (79, 'S/F 6 COLOR MATT & SILKY BLUSHON', 855),
      (80, 'S/F 6PCS BLENDING PUFF JAR', 575),
      (81, 'S/F 3PCS BLENDING PUFF BOTTLE', 405),
      (82, 'S/F 18 COLOR TERRACOTA EYE SHADE', 980),
      (83, 'S/F 24 COLOR PROF VELVET EYE SHADE KIT', 875),
      (84, 'S/F BODY WAX STRIPS 20PCS', 410),
      (85, 'S/F 36 COLOR EYE SHADE KIT', 360),
      (86, 'S/F FACE WAX STRIPS 20PCS', 285),
      (87, 'S/F 16 COLOR GLITTEREYES PALETTE', 845),
      (88, 'S/F NOSE STRIPS (BLACK HEAD REMOVER) 6PCS', 285),
      (89, 'S/F 26 COLOR EYE LIGHT BRILLIANT KIT', 420),
      (90, 'S/F WAX PAPER 50PCS NON-WOOVEN', 195),
      (91, 'S/F 25 COLOR DREAMY MATTE EYESHADOW KIT', 1200),
      (92, 'S/F WAX PAPER 100PCS NON-WOOVEN', 315),
      (93, 'S/F 24 COLOR SILKY & VELVET EYESHADOW KIT', 1095),
      (94, 'S/F FINGER GEL WAX 220GM', 380),
      (95, 'S/F 35+35 INTENSE MATTE & SHIMMER EYESHADOW PALETTE', 1990)
    ) AS t(ord, name_en, tp)
    ORDER BY ord
  LOOP
    v_name := r.name_en;
    v_tp := r.tp;

    -- Already restored?
    v_new_id := NULL;
    SELECT id INTO v_new_id
    FROM public.products
    WHERE company_id = v_imran
      AND default_warehouse_id = v_imran_wh
      AND lower(trim(name_en)) = lower(trim(v_name))
    LIMIT 1;

    IF v_new_id IS NOT NULL THEN
      -- Still relink spokes below via name.
      CONTINUE;
    END IF;

    -- Prefer Umar Cosmetic copy, else Ishaq.
    SELECT p.* INTO v_src
    FROM public.products p
    JOIN public.companies c ON c.id = p.company_id AND c.name = 'Umar Cosmetic'
    JOIN public.warehouses w ON w.id = p.default_warehouse_id AND lower(trim(w.name)) = 'sweet face'
    WHERE lower(trim(p.name_en)) = lower(trim(v_name))
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT p.* INTO v_src
      FROM public.products p
      JOIN public.companies c ON c.id = p.company_id AND c.name = 'Ishaq Enterprises'
      JOIN public.warehouses w ON w.id = p.default_warehouse_id AND lower(trim(w.name)) = 'sweet face'
      WHERE lower(trim(p.name_en)) = lower(trim(v_name))
      LIMIT 1;
    END IF;

    v_ord := v_ord + 1;
    v_code := (v_max_code + v_ord)::text;

    IF FOUND THEN
      INSERT INTO public.products (
        organization_id, company_id, code, name_en, name_ur,
        product_type, manufacturer, category_group, barcode, extra_barcodes,
        default_warehouse_id,
        retail_rate, purchase_rate, wholesale_rate, sale_rate, print_rate,
        opening_rate, opening_qty, reorder_level, packing, unit_type, base_unit, scheme,
        is_active
      ) VALUES (
        v_org, v_imran, v_code, v_src.name_en, v_src.name_ur,
        v_src.product_type, COALESCE(NULLIF(trim(v_src.manufacturer), ''), 'SWEET FACE'),
        v_src.category_group, NULL, COALESCE(v_src.extra_barcodes, '[]'::jsonb),
        v_imran_wh,
        v_src.retail_rate, v_src.purchase_rate, v_src.wholesale_rate, v_src.sale_rate, v_src.print_rate,
        v_src.opening_rate, 0, v_src.reorder_level, v_src.packing, v_src.unit_type, v_src.base_unit, v_src.scheme,
        true
      )
      RETURNING id INTO v_new_id;

      v_qty := 0;
      SELECT COALESCE(sb.qty, 0) INTO v_qty
      FROM public.stock_balances sb
      WHERE sb.product_id = v_src.id
        AND sb.warehouse_id = v_src.default_warehouse_id;

      IF COALESCE(v_qty, 0) <> 0 THEN
        PERFORM private.apply_stock_delta(
          v_imran, v_imran_wh, v_new_id, v_qty,
          'adjustment', 'products', v_new_id, true
        );
        UPDATE public.products
        SET opening_qty = v_qty
        WHERE id = v_new_id;
      END IF;
    ELSE
      -- Seed fallback (2 items missing from Umar/Ishaq).
      INSERT INTO public.products (
        organization_id, company_id, code, name_en, manufacturer,
        default_warehouse_id,
        retail_rate, purchase_rate, wholesale_rate, sale_rate, print_rate,
        opening_qty, opening_rate, reorder_level,
        packing, unit_type, base_unit,
        is_active
      ) VALUES (
        v_org, v_imran, v_code, v_name, 'SWEET FACE',
        v_imran_wh,
        v_tp, 0, 0, v_tp, v_tp,
        0, 0, 0,
        1, 'Unit', 'Unit',
        true
      )
      RETURNING id INTO v_new_id;
    END IF;
  END LOOP;

  -- Relink spoke copies to restored Imran hub products (by exact name).
  UPDATE public.products sp
  SET hub_product_id = hp.id,
      updated_at = now()
  FROM public.products hp
  JOIN public.companies hc ON hc.id = hp.company_id AND hc.name = 'Imran Traders'
  JOIN public.warehouses hw ON hw.id = hp.default_warehouse_id AND lower(trim(hw.name)) = 'sweet face'
  WHERE sp.company_id IN (
      SELECT id FROM public.companies WHERE name IN ('Ishaq Enterprises', 'Umar Cosmetic')
    )
    AND sp.default_warehouse_id IN (
      SELECT w.id FROM public.warehouses w
      JOIN public.companies c ON c.id = w.company_id
      WHERE c.name IN ('Ishaq Enterprises', 'Umar Cosmetic')
        AND lower(trim(w.name)) = 'sweet face'
    )
    AND lower(trim(sp.name_en)) = lower(trim(hp.name_en))
    AND hp.name_en LIKE 'S/F %'
    AND sp.hub_product_id IS DISTINCT FROM hp.id;

  PERFORM private.set_hub_mirroring(false);
END;
$$;
