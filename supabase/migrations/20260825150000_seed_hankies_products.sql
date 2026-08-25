-- Seed HANKIES TISSUE product masters (Imran Traders / HANKIES warehouse)
WITH seed(code, name_en) AS (
  VALUES
  ('1067', 'HANKIES VIRSA TISSUE RS 350'),
  ('1128', 'HANKIES COMPACTA TISSUE RS 110'),
  ('1129', 'HANKIES HIPHOP RS 150'),
  ('1130', 'HANKIES HOPUP MINI RS 150'),
  ('1131', 'HANKIES GOLD TISSUE RS 180'),
  ('1132', 'HANKIES HOPUP BLACK BOX TISSUE RS 250'),
  ('1133', 'HANKIES GARDEN TISSUE RS 300'),
  ('1134', 'HANKIES FLORA TISSUE RS 200'),
  ('1135', 'HANKIES SOFTIES 3+1 RS 825'),
  ('1136', 'HANKIES SOFTIES RS 275'),
  ('1137', 'HANKIES PREMIUM SOFT RS 440'),
  ('1138', 'HANKIES PREMIUM PERFUME NEW RS 480'),
  ('1139', 'HANKIES PREMIUM PERFUME RS 460'),
  ('1140', 'HANKIES HOTPOT PARTY PACK RS 300'),
  ('1141', 'HANKIES MAGIC ROLL RS 130'),
  ('1142', 'HANKIES KITCHEN JUMBO ROLL RS 600'),
  ('1143', 'HANKIES KITCHEN SUPER ROLL RS 320'),
  ('1144', 'HANKIES POCKET TISSUE 24 PCS RS 480'),
  ('1145', 'HANKIES MAXI KITCHEN TOWEL RS 1300'),
  ('1146', 'HANKIES FREEDOM XXL 16 PCS RS 480')
),
ctx AS (
  SELECT
    c.id AS company_id,
    c.organization_id,
    w.id AS warehouse_id
  FROM public.companies c
  JOIN public.warehouses w
    ON w.company_id = c.id
   AND w.name = 'HANKIES'
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
  'HANKIES',
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
