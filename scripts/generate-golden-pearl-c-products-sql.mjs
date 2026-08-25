/**
 * Generate SQL to seed GOLDEN PEARL RANG C product masters for Ishaq Enterprises.
 * Usage: node scripts/generate-golden-pearl-c-products-sql.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsv = fs.readFileSync(path.join(__dirname, "golden-pearl-c-products.tsv"), "utf8");

function esc(s) {
  return String(s).replace(/'/g, "''");
}

const rows = tsv
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .filter(Boolean)
  .map((line) => {
    const tab = line.indexOf("\t");
    const code = line.slice(0, tab).trim();
    const name_en = line.slice(tab + 1).trim();
    return { code, name_en };
  });

const values = rows
  .map((r) => `('${esc(r.code)}', '${esc(r.name_en)}')`)
  .join(",\n  ");

const sql = `-- Seed GOLDEN PEARL RANG C product masters (Ishaq Enterprises / GOLDEN PEARL C warehouse)
WITH seed(code, name_en) AS (
  VALUES
  ${values}
),
ctx AS (
  SELECT
    c.id AS company_id,
    c.organization_id,
    w.id AS warehouse_id
  FROM public.companies c
  JOIN public.warehouses w
    ON w.company_id = c.id
   AND w.name = 'GOLDEN PEARL C'
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
`;

const out = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260825155000_seed_golden_pearl_c_products.sql",
);
fs.writeFileSync(out, sql, "utf8");
console.log(`Wrote ${rows.length} products -> ${out}`);
