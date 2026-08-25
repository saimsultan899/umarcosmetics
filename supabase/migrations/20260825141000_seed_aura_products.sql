-- Seed AURA product masters (Umar Cosmetic / AURA warehouse)
WITH seed(code, name_en) AS (
  VALUES
  ('402', 'SH 01'),
  ('403', 'SH 02'),
  ('404', 'SH 446'),
  ('405', 'SH 447'),
  ('406', 'SH 05'),
  ('407', 'SH 06'),
  ('408', 'SH 07'),
  ('409', 'SH 08'),
  ('410', 'SH 13'),
  ('411', 'SH 14'),
  ('412', 'SH 26'),
  ('413', 'SH 16'),
  ('414', 'SH 17'),
  ('415', 'SH 20'),
  ('416', 'SH 51'),
  ('417', 'SH 52'),
  ('418', 'SH 109'),
  ('419', 'SH 110'),
  ('420', 'SH 333'),
  ('421', 'SH 334'),
  ('422', 'SH 335'),
  ('423', 'SH 338'),
  ('424', 'SH 339'),
  ('425', 'SH 421'),
  ('426', 'SH 422'),
  ('427', 'SH 444'),
  ('428', 'SH 445'),
  ('429', 'SH 557'),
  ('430', 'SH 558'),
  ('431', 'SH 559'),
  ('432', 'SH 560'),
  ('433', 'SH 555'),
  ('434', 'SH 556'),
  ('435', 'SH 666'),
  ('436', 'SH 667'),
  ('437', 'SH 965'),
  ('438', 'SH 601'),
  ('439', 'SH 030'),
  ('441', 'AURA NIPPLE SMALL'),
  ('443', 'SH 602'),
  ('444', 'SH 15'),
  ('445', 'SH 964'),
  ('448', 'SH 019'),
  ('449', 'SH 907'),
  ('450', 'SH 908'),
  ('451', 'SH 337'),
  ('452', 'SH 116'),
  ('513', 'SH 1929'),
  ('514', 'SH 27'),
  ('515', 'SH C90'),
  ('516', 'AURA WIPES'),
  ('517', 'COMB 106'),
  ('518', 'COMB 107'),
  ('519', 'COMB F10'),
  ('520', 'COMB H10'),
  ('521', 'COMB FC401'),
  ('522', 'SH 28'),
  ('560', 'SH 115'),
  ('883', 'SH 031'),
  ('884', 'SH 336'),
  ('941', 'SH 340'),
  ('942', 'SH 341'),
  ('1030', 'AURA NIPPLE LARGE'),
  ('1065', 'SH 103'),
  ('1066', 'SH 104'),
  ('1071', 'SH 1890'),
  ('1072', 'SH 1891'),
  ('1073', 'SH 1892'),
  ('1074', 'SH 1893'),
  ('1075', 'SH 1894'),
  ('1076', 'SH 1895'),
  ('1077', 'SH 105')
),
ctx AS (
  SELECT
    c.id AS company_id,
    c.organization_id,
    w.id AS warehouse_id
  FROM public.companies c
  JOIN public.warehouses w
    ON w.company_id = c.id
   AND w.name = 'AURA'
   AND w.is_active = true
  WHERE c.name = 'Umar Cosmetic'
)
INSERT INTO public.products (
  organization_id,
  company_id,
  code,
  name_en,
  manufacturer,
  default_warehouse_id,
  is_active
)
SELECT
  ctx.organization_id,
  ctx.company_id,
  seed.code,
  seed.name_en,
  'AURA',
  ctx.warehouse_id,
  true
FROM seed
CROSS JOIN ctx
ON CONFLICT (company_id, code) DO UPDATE SET
  name_en = EXCLUDED.name_en,
  manufacturer = EXCLUDED.manufacturer,
  default_warehouse_id = EXCLUDED.default_warehouse_id,
  is_active = true,
  updated_at = now();
