-- Seed warehouses for Umar Cosmetic, Ishaq Enterprises, and Imran Traders

WITH warehouse_seed(company_name, warehouse_name) AS (
  VALUES
    -- Umar Cosmetic
    ('Umar Cosmetic', 'AURA'),
    ('Umar Cosmetic', 'DERMACOS'),
    ('Umar Cosmetic', 'GLUTAWHITE'),
    ('Umar Cosmetic', 'KEUNE'),
    ('Umar Cosmetic', 'SOFT TOUCH'),
    ('Umar Cosmetic', 'STAR CARE'),
    ('Umar Cosmetic', 'SWEET FACE'),
    -- Ishaq Enterprises
    ('Ishaq Enterprises', 'GOLDEN PEARL A'),
    ('Ishaq Enterprises', 'GOLDEN PEARL B'),
    ('Ishaq Enterprises', 'GOLDEN PEARL C'),
    -- Imran Traders
    ('Imran Traders', 'BELLINI HAIR COLOR'),
    ('Imran Traders', 'HANKIES'),
    ('Imran Traders', 'CITY GIRL'),
    ('Imran Traders', 'FAUJI'),
    ('Imran Traders', 'NISA'),
    ('Imran Traders', 'HB11'),
    ('Imran Traders', 'TEHREEM SKIN POLISH'),
    ('Imran Traders', 'GO AND NICE'),
    ('Imran Traders', 'SOGO'),
    ('Imran Traders', 'GOREY INTERNATIONAL'),
    ('Imran Traders', 'PERFECT ERA SOL'),
    ('Imran Traders', 'BODYSOL'),
    ('Imran Traders', 'LIOK'),
    ('Imran Traders', 'COSWIN'),
    ('Imran Traders', 'FAHA'),
    ('Imran Traders', 'ASTER')
)
INSERT INTO public.warehouses (organization_id, company_id, name, code)
SELECT
  c.organization_id,
  c.id,
  ws.warehouse_name,
  left(upper(regexp_replace(ws.warehouse_name, '[^A-Za-z0-9]', '', 'g')), 12)
FROM warehouse_seed ws
JOIN public.companies c ON c.name = ws.company_name
ON CONFLICT (company_id, name) DO NOTHING;
