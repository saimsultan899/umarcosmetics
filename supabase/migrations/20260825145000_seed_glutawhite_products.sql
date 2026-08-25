-- Seed GULTA WHITE / GLUTAWHITE product masters (Umar Cosmetic)
WITH seed(code, name_en) AS (
  VALUES
  ('1035', 'GW FACE WASH 120 ML'),
  ('1036', 'GW WHITE SCRUB 200 ML'),
  ('1037', 'GW FACE WASH RICE 120 ML'),
  ('1038', 'GW FACE WASH ANTI ACNE 120 ML'),
  ('1039', 'GW SERUM WHITEING 30 ML'),
  ('1040', 'GW SERUM ACNI 30 ML'),
  ('1041', 'GW DEEP CLEANSER 200ML'),
  ('1042', 'GW SUNBLOCK 120ML'),
  ('1043', 'GW SKIN POLISH SET'),
  ('1044', 'GW NIGHT CREAM TUBE'),
  ('1045', 'GW LOTION OIL FREE 100ML'),
  ('1046', 'GW HAND&FOOT CREAM'),
  ('1047', 'GW SERUM RICE 30 ML'),
  ('1048', 'GW SERUM VITAMIN C 30 ML'),
  ('1049', 'GW FACE WASH VITAMIN C 120 ML'),
  ('1050', 'GW WHITING CREAM'),
  ('1062', 'GW DAY ND NIGHT CREAM JAR'),
  ('1069', 'GW WHITING FACIAL KIT'),
  ('1081', 'GW WHITE SOAP'),
  ('1082', 'GW BLEACH CREAM SACHET')
),
ctx AS (
  SELECT
    c.id AS company_id,
    c.organization_id,
    w.id AS warehouse_id
  FROM public.companies c
  JOIN public.warehouses w
    ON w.company_id = c.id
   AND w.name = 'GLUTAWHITE'
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
  'GLUTAWHITE',
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
