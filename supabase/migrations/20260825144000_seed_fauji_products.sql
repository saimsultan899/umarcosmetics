-- Seed FAUJI CERELS product masters (Imran Traders / FAUJI warehouse)
WITH seed(code, name_en) AS (
  VALUES
  ('652', 'FAUJI WHEAT PORRIDGE 1 KG'),
  ('653', 'FAUJI WHEAT PORRIDGE 250 GM'),
  ('654', 'FAUJI WHEAT PORRIDGE 175 GM'),
  ('655', 'FAUJI WHEAT PORRIDGE 100 GM'),
  ('656', 'FAUJI WHEAT PORRIDGE 50 GM'),
  ('657', 'FAUJI BARLEY PORRIDGE 1 KG'),
  ('658', 'FAUJI BARLEY PORRIDGE 250 GM'),
  ('659', 'FAUJI BARLEY PORRIDGE 175 GM'),
  ('660', 'FAUJI BARLEY PORRIDGE 100 GM'),
  ('661', 'FAUJI BARLEY PORRIDGE 50 GM'),
  ('662', 'FAUJI CORN FLAKES 500 GM'),
  ('663', 'FAUJI CORN FLAKES 250 GM'),
  ('664', 'FAUJI CORN FLAKES 150 GM'),
  ('665', 'FAUJI CORN FLAKES MANGO 150 GM'),
  ('666', 'FAUJI CORN FLAKES STRABERRY 150 GM'),
  ('667', 'FAUJI RICE FLAKES 250 GM'),
  ('668', 'FAUJI CHOCO POPS 150 GM'),
  ('669', 'FAUJI CHOCO CUPS 150 GM'),
  ('670', 'FAUJI MUESLI 250 GM'),
  ('671', 'FAUJI CUSTARD 275 GM'),
  ('672', 'FAUJI CUSTARD 120 GM'),
  ('673', 'FAUJI KHEER MIX SPECIAL 155 GM'),
  ('674', 'FAUJI JELLY QUICK SET 80 GM'),
  ('675', 'FAUJI CORN FLOUR 275 GM'),
  ('676', 'FAUJI RICE FLOUR 300 GM'),
  ('798', 'FAUJI CHOCO CHUCKLES 150GM'),
  ('823', 'FAUJI FIT FIBER 150GM'),
  ('825', 'FAUJI BARLEY PORRIDGE 500 GM'),
  ('826', 'FAUJI CORN FLAKES BANANA 150 GM'),
  ('827', 'FAUJI CORN FLAKES BANANA 250 GM'),
  ('828', 'FAUJI WHEAT FLAKES 250 GM'),
  ('829', 'FAUJI BRAN FLAKES 250GM'),
  ('830', 'FAUJI HONEY FLAKES 250GM'),
  ('831', 'FAUJI CUSTARD SACHET 25 GM'),
  ('832', 'FAUJI KALAF 300GM'),
  ('833', 'FAUJI WHEAT PORRIDGE 500 GM'),
  ('834', 'FAUJI TALBEENA SHUGER FREE BLU BOX 200GM'),
  ('835', 'FAUJI TALBEENA ORIGNAL 200GM'),
  ('878', 'FAUJI CHOCO CUPS 250 GM'),
  ('879', 'FAUJI CHOCO POPS 250 GM')
),
ctx AS (
  SELECT
    c.id AS company_id,
    c.organization_id,
    w.id AS warehouse_id
  FROM public.companies c
  JOIN public.warehouses w
    ON w.company_id = c.id
   AND w.name = 'FAUJI'
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
  'FAUJI',
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
