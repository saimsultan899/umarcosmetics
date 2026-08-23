/**
 * City (head) and Sector options for party / shop masters.
 * Stored as parties.city and parties.route (UI label: Sector).
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

/** Sectors / market areas under Layyah and nearby towns. */
export const PARTY_SECTORS = [
  "Fatehpur",
  "Karor Lal Eson",
  "Kot Sultan",
  "Chowk Azam",
  "Chaubara",
  "Jaman Shah",
  "Ladhana",
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

export type PartyCity = (typeof PARTY_CITIES)[number];
export type PartySector = (typeof PARTY_SECTORS)[number];

/** Keep a saved value selectable even if it is not in the master list. */
export function withCurrentOption(
  options: readonly string[],
  current: string | null | undefined,
): string[] {
  const value = (current || "").trim();
  if (!value) return [...options];
  if (options.some((o) => o.toLowerCase() === value.toLowerCase())) {
    return [...options];
  }
  return [value, ...options];
}
