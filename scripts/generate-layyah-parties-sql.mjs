/**
 * Generate SQL to seed Layyah party sheet into all companies.
 * Usage: node scripts/generate-layyah-parties-sql.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsv = fs.readFileSync(path.join(__dirname, "layyah-parties.tsv"), "utf8");

function esc(s) {
  return String(s).replace(/'/g, "''");
}

function parsePhone(name) {
  const m = name.match(/\s+(0\d{10})\s*$/);
  if (!m) return { name: name.trim(), mobile: null };
  return { name: name.slice(0, m.index).trim(), mobile: m[1] };
}

const rows = tsv
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .filter(Boolean)
  .map((line) => {
    const [sector, code, ...rest] = line.split("\t");
    const raw = rest.join("\t").trim();
    const { name, mobile } = parsePhone(raw);
    return { sector, code, name, mobile };
  });

const values = rows
  .map((r) => {
    const mobile = r.mobile ? `'${esc(r.mobile)}'` : "NULL";
    return `('${esc(r.code)}', '${esc(r.name)}', '${esc(r.sector)}', ${mobile})`;
  })
  .join(",\n  ");

const sql = `-- Seed Layyah party masters (city/head = Layyah / Main Layyah) for all companies
WITH seed(party_code, name_en, route, mobile) AS (
  VALUES
  ${values}
),
companies AS (
  SELECT id AS company_id, organization_id
  FROM public.companies
  WHERE name IN ('Umar Cosmetic', 'Ishaq Enterprises', 'Imran Traders')
)
INSERT INTO public.parties (
  organization_id,
  company_id,
  party_code,
  name_en,
  party_type,
  party_subtype,
  city,
  head,
  route,
  mobile,
  sale_channel,
  is_active
)
SELECT
  c.organization_id,
  c.company_id,
  s.party_code,
  s.name_en,
  'PARTY'::public.party_type,
  'customer'::public.party_subtype,
  'Layyah',
  'Main Layyah',
  s.route,
  s.mobile,
  'retail'::public.sale_channel,
  true
FROM seed s
CROSS JOIN companies c
ON CONFLICT (company_id, party_code) DO UPDATE
SET
  name_en = EXCLUDED.name_en,
  city = EXCLUDED.city,
  head = EXCLUDED.head,
  route = EXCLUDED.route,
  mobile = COALESCE(EXCLUDED.mobile, public.parties.mobile),
  party_subtype = EXCLUDED.party_subtype,
  is_active = true,
  updated_at = now();
`;

const out = path.join(__dirname, "..", "supabase", "migrations", "20260825130000_seed_layyah_parties.sql");
fs.writeFileSync(out, sql);
console.log(`Wrote ${rows.length} parties x 3 companies -> ${out}`);
console.log(`SQL size: ${sql.length} chars`);
