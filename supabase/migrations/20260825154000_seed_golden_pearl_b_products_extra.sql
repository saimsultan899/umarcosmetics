-- Seed additional GOLDEN PEARL RANG B products (Ishaq Enterprises / GOLDEN PEARL B)
WITH seed(code, name_en) AS (
  VALUES
  ('141', 'GP AIOE VERA GEL 75ML TUBE'),
  ('142', 'GP AIOE VERA GEL 150 ML JAR'),
  ('143', 'GP 24K GOLD CREAM BLEACH SACHET'),
  ('156', 'GP 24K SERUM NEW GLASS BOTEL 10 ML'),
  ('157', 'GP 4X GLUTATHIONE SERURM NEW 10 ML GLASS'),
  ('158', 'GP V.C SERUM NEW 10 ML GLASS BOTTEL'),
  ('159', 'GP 24K SERUM NEW GLASS BOTEL 30 ML'),
  ('160', 'GP V.C SERUM NEW 30 ML GLASS BOTTEL'),
  ('161', 'GP 4X GLUTATHIONE SERURM NEW 30 ML GLASS'),
  ('162', 'GP DOUBLE ACTION 250 GM'),
  ('163', 'GP SCRUB BERRIES GLOW RED 250 GM'),
  ('164', 'GP SCRUB APPLE GLOW 250 GM'),
  ('165', 'GP GLOW MUD MASK 250GM'),
  ('166', 'GP CLAY PURIFYING MASK 250 GM'),
  ('167', 'GP MASSAGE MULTI MINRAL CREAM 250 GM'),
  ('168', 'GP MASSAGE MULTIVITAMIN CREAM 250GM'),
  ('169', 'GP SKIN POLISH RADIANT GLOW 250GM'),
  ('176', 'GP SKIN TONER NEW 150 ML'),
  ('177', 'GP MICELLAR CLEANSING WATER 150 ML'),
  ('178', 'GP CLEANSING MIL 150ML')
),
ctx AS (
  SELECT
    c.id AS company_id,
    c.organization_id,
    w.id AS warehouse_id
  FROM public.companies c
  JOIN public.warehouses w
    ON w.company_id = c.id
   AND w.name = 'GOLDEN PEARL B'
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
