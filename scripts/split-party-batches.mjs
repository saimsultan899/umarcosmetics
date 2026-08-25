import fs from "fs";

const sql = fs.readFileSync(
  "supabase/migrations/20260825130000_seed_layyah_parties.sql",
  "utf8",
);
const valuesMatch = sql.match(/VALUES\n([\s\S]*?)\n\),\ncompanies AS/);
if (!valuesMatch) {
  console.error("parse fail");
  process.exit(1);
}
const values = valuesMatch[1];
const companies = ["Umar Cosmetic", "Ishaq Enterprises", "Imran Traders"];

for (const [i, name] of companies.entries()) {
  const q = `WITH seed(party_code, name_en, route, mobile) AS (
  VALUES
  ${values}
),
companies AS (
  SELECT id AS company_id, organization_id
  FROM public.companies
  WHERE name = '${name}'
)
INSERT INTO public.parties (
  organization_id, company_id, party_code, name_en, party_type, party_subtype,
  city, head, route, mobile, sale_channel, is_active
)
SELECT
  c.organization_id, c.company_id, s.party_code, s.name_en,
  'PARTY'::public.party_type, 'customer'::public.party_subtype,
  'Layyah', 'Main Layyah', s.route, s.mobile,
  'retail'::public.sale_channel, true
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
  updated_at = now();`;
  fs.writeFileSync(`scripts/_batch_${i}.sql`, q);
  console.log(name, q.length);
}
