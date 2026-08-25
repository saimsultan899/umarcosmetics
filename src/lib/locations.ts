/**
 * Bootstrap city / sector labels for empty companies.
 * Live party masters (code, name, city, sector) live in public.parties — not here.
 * The party form prefers distinct values already stored for the company.
 */

export const PARTY_CITIES = [
  "Layyah",
  "Karor Lal Esan",
  "Chowk Azam",
  "Bhakkar",
  "Muzaffargarh",
  "Kot Addu",
  "Dera Ghazi Khan",
] as const;

export const PARTY_SECTORS = [
  "Layyah",
  "Layyah C",
  "Chowk Azam",
  "Fatehpur",
  "Kot Sultan",
  "Kror Lale Eisan",
  "Ladhana",
  "Chaubara",
  "Jaman Shah",
  "Peer Jaggi",
  "Qadirabad",
  "Shahpur",
  "Thal Jandi",
  "Nawan Kot",
  "Kot Addu",
  "Notak",
  "Pahar Pur",
  "Sarai Muhajir",
  "Tibbi Qaisrani",
  "Dajal",
] as const;

/** Merge DB values + bootstrap + current edit value, case-insensitive unique. */
export function mergeLocationOptions(
  fromDb: readonly string[],
  bootstrap: readonly string[],
  current?: string | null,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...fromDb, ...bootstrap, current || ""]) {
    const value = String(raw || "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** @deprecated use mergeLocationOptions */
export function withCurrentOption(
  options: readonly string[],
  current: string | null | undefined,
): string[] {
  return mergeLocationOptions([], options, current);
}

export function headFromCity(city: string | null | undefined): string | null {
  const value = (city || "").trim();
  if (!value) return null;
  if (value.toLowerCase() === "layyah") return "Main Layyah";
  return value;
}
