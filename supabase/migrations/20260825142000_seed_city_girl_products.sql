-- Seed CITY GIRL product masters (Imran Traders / CITY GIRL warehouse)
WITH seed(code, name_en) AS (
  VALUES
  ('1095', 'CITY GIRLS BLEACH SACHET MIX POUCH'),
  ('1096', 'CITY GIRLS FACE WASH MIX'),
  ('1097', 'CITY GIRLS SKIN POLISH SACHET KIT'),
  ('1098', 'CITY GIRLS FINGER WAX LEMON'),
  ('1099', 'CITY GIRLS MANIPEDI CURE KIT'),
  ('1100', 'CITY GIRLS HAND ND FOOT BLEACH'),
  ('1101', 'CITY GIRLS ICE BLEACH SACHET'),
  ('1102', 'CITY GIRLS BLEACH CHARCOL 2 IN 1'),
  ('1103', 'CITY GIRLS SKIN POLISH BOTEL MIX'),
  ('1104', 'CITY GIRLS MULTANI MATTI SACHET'),
  ('1105', 'CITY GIRLS FACIAL TUBE 24K GOLD DUST')
),
ctx AS (
  SELECT
    c.id AS company_id,
    c.organization_id,
    w.id AS warehouse_id
  FROM public.companies c
  JOIN public.warehouses w
    ON w.company_id = c.id
   AND w.name = 'CITY GIRL'
   AND w.is_active = true
  WHERE c.name = 'Imran Traders'
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
  'CITY GIRL',
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
