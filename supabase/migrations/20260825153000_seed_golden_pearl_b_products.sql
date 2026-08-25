-- Seed GOLDEN PEARL RANG B product masters (Ishaq Enterprises / GOLDEN PEARL B warehouse)
WITH seed(code, name_en) AS (
  VALUES
  ('14', 'MACKUP REMOVER 125ML'),
  ('15', 'GP FLAWLESS FACE WASH 75ML'),
  ('16', 'GP FACIAL CLEANSER PUMP 150ML'),
  ('17', 'GP TONER PUMP 150ML'),
  ('18', 'GP BLACK HEAD REMOVING MASK 30ML'),
  ('19', 'GP GLO BOSTING WHITENING SERUM 3ML'),
  ('20', 'GP FLAWLESS SERUM 3ML'),
  ('21', 'GP ANTI AGING SERUM 3ML'),
  ('22', 'GP FLAWLESS CREAM 25GM'),
  ('23', 'GP GLOW BOOSTING CREAM 50GM'),
  ('24', 'GP BLEACH POWDER 30GM'),
  ('25', 'GP BLEACH POWDER 60GM'),
  ('26', 'GP BLEACH POWDER 200GM'),
  ('27', 'GP BLEACH POWDER 400GM'),
  ('28', 'GP VOL 20 60ML'),
  ('29', 'GP VOL 20 120ML'),
  ('30', 'GP VOL 20 500ML'),
  ('31', 'GP VOL 20 1000ML'),
  ('32', 'GP SOOING LOTION 60ML'),
  ('33', 'GP SOOING LOTION 120ML'),
  ('34', 'GP SOOING LOTION 500ML'),
  ('35', 'GP SOOING LOTION 1000ML'),
  ('36', 'GP SKIN SHINER 60ML'),
  ('37', 'GP SKIN SHINER 120ML'),
  ('38', 'GP SKIN SHINER 500ML'),
  ('39', 'GP SKIN SHINER 1000ML'),
  ('40', 'GP WHITENING FACIAL KIT 11 ITEM'),
  ('41', 'GP FLAWLESS BEAUTY KIT 3 ITEM'),
  ('42', 'GP SKIN POLISH SACHET KIT 7 ITEM'),
  ('43', 'GP URGENT FACIAL SACHET NEW RATE 25ML'),
  ('44', 'GP URGENT FRUIT FACIAL SACHET NEW RATE 25ML'),
  ('45', 'GP URGENT FACIAL TUBE 75ML'),
  ('46', 'GP URGENT FRUIT FACIAL TUBE 75ML'),
  ('47', 'GP DOUBLE ACTION 75 GM'),
  ('48', 'GP SCRUB JAR 75GM GREEN'),
  ('49', 'GP SCRUB JAR 75GM PINK'),
  ('50', 'GP MUD GLOW MASK 75GM'),
  ('51', 'GP CLAY MASK JAR 75GM'),
  ('52', 'GP MASSAGE CREAM 75GM PINK'),
  ('53', 'GP MASSAGE CREAM 75GM YELLOW'),
  ('54', 'GP SKIN POLISH JAR 75GM'),
  ('55', 'GP DOUBLE ACTION 300 GM'),
  ('56', 'GP SCRUB JAR 300GM GREEN'),
  ('57', 'GP SCRUB JAR 300GM PINK'),
  ('58', 'GP MUD MASK 300GM'),
  ('59', 'GP CLAY MASK JAR 300GM'),
  ('60', 'GP SKIN POLISH JAR 300GM'),
  ('61', 'GP MASSAGE CREAM 300GM PINK'),
  ('62', 'GP MASSAGE CREAM 300GM YELLOW'),
  ('63', 'GP COLD JAR 75 ML'),
  ('64', 'GP COLD JAR 200ML'),
  ('65', 'GP 24K SERUM 20ML'),
  ('66', 'GP 24K SERUM 10ML'),
  ('67', 'GP 4X SERUM 20ML'),
  ('68', 'GP 4X SERUM 10ML'),
  ('69', 'GP 3D SERUM 30ML NEW GLASS SERUM'),
  ('70', 'GP 3D SERUM 10ML NEW GLASS BOTEL'),
  ('94', 'GP NEW FACE POLISHING KIT 4PIC'),
  ('100', 'GP SOFT MASK SACHET'),
  ('112', 'GP COLD JAR 75ML NEW RATE'),
  ('113', 'GP COLD JAR 200ML NEW RATE'),
  ('122', 'GP FLAWLESS FACE WASH 150ML'),
  ('138', 'ACNO CLEAR FACE WASH 75 ML'),
  ('139', 'ACNO CLEAR FACE WASH 150 ML')
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
