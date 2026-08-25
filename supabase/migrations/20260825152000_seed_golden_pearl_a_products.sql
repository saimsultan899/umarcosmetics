-- Seed GOLDEN PEARL RANG A product masters (Ishaq Enterprises / GOLDEN PEARL A warehouse)
WITH seed(code, name_en) AS (
  VALUES
  ('71', 'GP W CREAM 28GM'),
  ('72', 'FACE WASH SAMAL 75ML OLD RATE'),
  ('73', 'FACE WASH SMALL 75ML NEW RATE'),
  ('74', 'RANG A'),
  ('75', 'RANG A'),
  ('76', 'FACE WASH MEN 75ML'),
  ('77', 'FACE WASH LARGE 150ML OLD RATE'),
  ('78', 'FACE WASH LARGE 150ML NEW RATE'),
  ('79', 'RANG A'),
  ('80', 'RANG A'),
  ('82', 'GP SOAP NORMAL 100GM'),
  ('83', 'GP SOAP DRY 100GM'),
  ('84', 'GP SOAP ACNI & OILY 100GM'),
  ('86', 'GP LIGHT & GLOW TUBE 25ML'),
  ('87', 'GP LIGHT & GLOW SACHET 12ML'),
  ('88', 'GP BB CREAM 18GM'),
  ('89', 'GP NO GASS BODY SPRAY M&U 200ML'),
  ('90', 'GP GASS BODY SPRAY 200ML'),
  ('91', 'GP MOISITURING LOTION 100ML OLD RATE'),
  ('92', 'GP MOISITURING LOTION 200ML OLD RATE'),
  ('93', 'GP MOISITURING LOTION 400ML OLD RATE'),
  ('95', 'FACE WASH MEN 150ML'),
  ('97', 'GP BODY LOTION 400 ML'),
  ('98', 'GP BODY LOTION 200 ML'),
  ('99', 'GP WHITE BEAUTY CREAM 50 ML'),
  ('101', 'GP LIGHT & GLOW JAR 70GM'),
  ('102', 'GP SUNBLOCK 60ML'),
  ('103', 'GP SUNBLOCK 120ML'),
  ('109', 'GP MOISITURING LOTION 100ML NEW RATE'),
  ('110', 'GP MOISITURING LOTION 200ML NEW RATE'),
  ('111', 'GP MOISITURING LOTION 400ML NEW RATE'),
  ('140', 'GP MOISITURING LOTION 50ML NEW RATE'),
  ('170', 'GP SUNBLOCK SEBUM 100ML'),
  ('171', 'GP SUNBLOCK SEBUM 40ML'),
  ('172', 'GP SUNBLOCK L&B 100ML'),
  ('173', 'GP SUNBLOCK L&B 40ML'),
  ('174', 'A'),
  ('179', 'GP RICE CREAM 50GM'),
  ('180', 'GP RICE SERUM 10ML'),
  ('181', 'GP RICE SERUM 30ML'),
  ('182', 'GP RICE CLEANSER 75ML'),
  ('183', 'GP RICE FACE WASH 75ML'),
  ('184', 'GP RICE FACE WASH 150ML'),
  ('185', 'GP RICE SKIN POLISHER 75ML'),
  ('186', 'GP RICE SKIN POLISHER 150ML'),
  ('187', 'GP RICE SCRUB TUBE 75ML'),
  ('188', 'GP RICE SCRUB TUBE 150ML'),
  ('189', 'GP RICE MASK POWDER 120GM'),
  ('190', 'GP RICE FACIAL KIT'),
  ('191', 'GP SUNBLOCK VITAMIN C 100ML'),
  ('192', 'GP SUNBLOCK VITAMIN C 40ML')
),
ctx AS (
  SELECT
    c.id AS company_id,
    c.organization_id,
    w.id AS warehouse_id
  FROM public.companies c
  JOIN public.warehouses w
    ON w.company_id = c.id
   AND w.name = 'GOLDEN PEARL A'
   AND w.is_active = true
  WHERE c.name = 'Ishaq Enterprises'
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
  'GOLDEN PEARL',
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
