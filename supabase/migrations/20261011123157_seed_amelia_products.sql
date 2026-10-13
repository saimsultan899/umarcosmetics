-- Seed AMELIA warehouse + rate-list products for Umar Group
-- (Imran Traders main, mirrored to Ishaq Enterprises + Umar Cosmetic).

WITH companies AS (
  SELECT id, organization_id, name
  FROM public.companies
  WHERE name IN ('Imran Traders', 'Ishaq Enterprises', 'Umar Cosmetic')
)
INSERT INTO public.warehouses (organization_id, company_id, name, code, is_active)
SELECT c.organization_id, c.id, 'AMELIA', 'AMELIA', true
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.warehouses w
  WHERE w.company_id = c.id AND lower(trim(w.name)) = 'amelia'
);

WITH params AS (
  SELECT
    c.organization_id AS org_id,
    c.id AS company_id,
    w.id AS warehouse_id,
    COALESCE((
      SELECT MAX(p.code::bigint) FROM public.products p
      WHERE p.company_id = c.id AND p.code ~ '^[0-9]+$'
    ), 0) AS max_code
  FROM public.companies c
  JOIN public.warehouses w
    ON w.company_id = c.id
   AND lower(trim(w.name)) = 'amelia'
  WHERE c.name = 'Imran Traders'
),
wanted AS (
  SELECT * FROM (VALUES
    (1, 'AMELIA ADVANCE B/O,E/S', 395),
    (2, 'AMELIA ADVANCE B/O,E/S (18*1)', 375),
    (3, 'AMELIA (BLACK BOX) B/O,E/S', 375),
    (4, 'AMELIA B/O,E/S VELVET COLOR', 370),
    (5, 'AMELIA 24 SPARKLE PALLETTE GLITTER TRAY', 550),
    (6, 'AMELIA 24 SPARKLE PALLETTE E/S,B/O', 550),
    (7, 'AMELIA NEW PRIMER', 395),
    (8, 'AMELIA NEW FACE POWDER', 240),
    (9, 'AMELIA NEW PAN CAKE', 250),
    (10, 'AMELIA PAINT STICK, IMPORTED', 375),
    (11, 'AMELIA LOOZE POWDER', 350),
    (12, 'AMELIA FACE SHINER', 225),
    (13, 'AMELIA MASCARA, IMPORTED', 250),
    (14, 'AMELIA EYE LINER, IMPORTED', 260),
    (15, 'AMELIA NEW 12 SHADES GLITTER EYE LINER', 250),
    (16, 'AMELIA NEW EYE LASH IMPORTED (NO CLAIM NO RETURN)', 125),
    (17, 'AMELIA NEW LIP STICK QUEEN IMPORTED', 185),
    (18, 'AMELIA NEW LIP GLOSS', 260),
    (19, 'AMELIA NEW FLAWLESS POWDER', 250),
    (20, 'AMELIA NEW GEL EYELINER 24 HR', 210),
    (21, 'AMELIA NEW DERMA PREMIUM BASE', 545),
    (22, 'AMELIA NEW MOUSSE MATT BASE', 450),
    (23, 'AMELIA NEW WATER PROOF LITE BASE', 350),
    (24, 'AMELIA ADVANCE P/CAKE', 350),
    (25, 'AMELIA ADVANCE SUMMER MICRO DRY CAKE', 325),
    (26, 'AMELIA ADVANCE C/PUFF', 375),
    (27, 'AMELIA ADVANCE LOOSE POWDER', 395),
    (28, 'AMELIA ADVANCE MASCARA IMPORTED', 265),
    (29, 'AMELIA ADVANCE EYE LINER IMPORTED', 265),
    (30, 'AMELIA ADVANCE SINGLE E/S', 75),
    (31, 'AMELIA GLO HD LIQUID FOUNDATION (NO CLAIM NO RETURN)', 475),
    (32, 'AMELIA ADVANCE SUPER STAY FOUNDATION (NO CLAIM NO RETURN)', 495),
    (33, 'AMELIA ADVANCE SHIMMERING HIGHLITER', 145),
    (34, 'AMELIA ADVANCE HIGHLITER+B/O 6IN1 (555)', 390),
    (35, 'AMELIA ADVANCE GLOW FACE HIGHLITER (5IN1)', 370),
    (36, 'AMELIA NEW RICE ORGANIC WHITENING GLOW KIT (3IN1)', 1490),
    (37, 'AMELIA CONTOURING BRUSH C-200', 80),
    (38, 'AMELIA CONTOURING + EYELINER BRUSH CE-201', 95),
    (39, 'AMELIA CONTOURING + CUT BRUSH CC-202', 95),
    (40, 'AMELIA APPLICATOR + EYELINER BRUSH AE-203', 95),
    (41, 'AMELIA APPLICATOR BRUSH A-204', 65),
    (42, 'AMELIA EYELINER E-205', 65),
    (43, 'AMELIA CUT BRUSH A-206', 80),
    (44, 'AMELIA CUT + LIP BRUSH CL-207', 95),
    (45, 'AMELIA BLEACH BRUSH (LARGE) BL-208', 140),
    (46, 'AMELIA BLEACH BRUSH (SMALL) BS-209', 95),
    (47, 'AMELIA BLUSH ON BRUSH (LARGE) BL-210', 230),
    (48, 'AMELIA BLUSH ON BRUSH (MEDIUM) BM-211', 195),
    (49, 'AMELIA XL B/O BRUSH -212', 280),
    (50, 'AMELIA FOUNDATIO BRUSH -213', 175),
    (51, 'AMELIA CUT BLUSH ON BRUSH (MEDIUM) BM-214', 170),
    (52, 'AMELIA LARGE CUT BRUSH -215', 110),
    (53, 'AMELIA LARGE CONTOURING BRUSH -216', 110),
    (54, 'AMELIA LARGE CONTOURING BRUSH -217', 135),
    (55, 'AMELIA LARGE EYE BROW BRUSH -218', 80),
    (56, 'AMELIA FACE WASH MIX', 295),
    (57, 'AMELIA MASK FACE WASH', 425),
    (58, 'AMELIA SCRUB FACE WASH', 450)
  ) AS t(ord, name_en, tp)
)
INSERT INTO public.products (
  organization_id, company_id, code, name_en, manufacturer,
  default_warehouse_id,
  retail_rate, purchase_rate, wholesale_rate, sale_rate, print_rate,
  opening_qty, opening_rate, reorder_level,
  packing, unit_type, base_unit,
  is_active
)
SELECT
  p.org_id,
  p.company_id,
  (p.max_code + w.ord)::text,
  w.name_en,
  'AMELIA',
  p.warehouse_id,
  w.tp, 0, 0, w.tp, w.tp,
  0, 0, 0,
  1, 'Unit', 'Unit',
  true
FROM wanted w
CROSS JOIN params p
WHERE NOT EXISTS (
  SELECT 1 FROM public.products x
  WHERE x.company_id = p.company_id
    AND upper(trim(x.name_en)) = w.name_en
);

-- Link copies on Ishaq + Umar to Imran hub products (shared stock).
SELECT private.set_hub_mirroring(true);

WITH spokes AS (
  SELECT c.id AS company_id, w.id AS warehouse_id
  FROM public.companies c
  JOIN public.warehouses w
    ON w.company_id = c.id
   AND lower(trim(w.name)) = 'amelia'
  WHERE c.name IN ('Ishaq Enterprises', 'Umar Cosmetic')
),
src AS (
  SELECT p.*
  FROM public.products p
  JOIN public.warehouses w ON w.id = p.default_warehouse_id
  JOIN public.companies c ON c.id = p.company_id
  WHERE c.name = 'Imran Traders'
    AND lower(trim(w.name)) = 'amelia'
    AND p.manufacturer = 'AMELIA'
)
INSERT INTO public.products (
  organization_id, company_id, code, name_en, name_ur,
  product_type, manufacturer, category_group, barcode, extra_barcodes,
  default_warehouse_id,
  retail_rate, purchase_rate, wholesale_rate, sale_rate, print_rate,
  opening_rate, opening_qty, reorder_level, packing, unit_type, base_unit, scheme,
  is_active, hub_product_id
)
SELECT
  src.organization_id,
  s.company_id,
  src.code,
  src.name_en,
  src.name_ur,
  src.product_type,
  src.manufacturer,
  src.category_group,
  NULL,
  '[]'::jsonb,
  s.warehouse_id,
  src.retail_rate, src.purchase_rate, src.wholesale_rate, src.sale_rate, src.print_rate,
  src.opening_rate, 0, src.reorder_level, src.packing, src.unit_type, src.base_unit, src.scheme,
  true,
  src.id
FROM src
CROSS JOIN spokes s
WHERE NOT EXISTS (
  SELECT 1 FROM public.products x
  WHERE x.company_id = s.company_id
    AND (
      x.hub_product_id = src.id
      OR lower(trim(x.code)) = lower(trim(src.code))
      OR upper(trim(x.name_en)) = upper(trim(src.name_en))
    )
);

SELECT private.set_hub_mirroring(false);
