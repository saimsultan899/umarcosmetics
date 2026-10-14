/** Same order as Arrange shops / parties list: `sort_order`, then `party_code`. */
export function comparePartyArrangement(
  a: { sort_order?: number | null; party_code?: string | null },
  b: { sort_order?: number | null; party_code?: string | null },
): number {
  const ao = Number(a.sort_order ?? 0);
  const bo = Number(b.sort_order ?? 0);
  if (ao !== bo) return ao - bo;
  return String(a.party_code || "").localeCompare(String(b.party_code || ""));
}
