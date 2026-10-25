import type { SupabaseClient } from "@supabase/supabase-js";

/** Latest collection that counts for the Last received column. */
export type SectorLastReceived = {
  partyId: string;
  amount: number;
  receivedDate: string;
  receivedAt: string;
  recoveryId: string;
};

type RpcRow = {
  party_id: string;
  amount: number | string;
  received_date: string;
  received_at: string;
  recovery_id: string | null;
};

function readRows(data: unknown): SectorLastReceived[] {
  const out: SectorLastReceived[] = [];
  for (const row of (data || []) as RpcRow[]) {
    const partyId = String(row.party_id || "");
    if (!partyId) continue;
    out.push({
      partyId,
      amount: Number(row.amount || 0),
      receivedDate: String(row.received_date || "").slice(0, 10),
      receivedAt: String(row.received_at || ""),
      recoveryId: row.recovery_id ? String(row.recovery_id) : "",
    });
  }
  return out;
}

/**
 * Last received as of `asOf`.
 * Shows the shop's amount from the latest collection of its sector on or
 * before that date. A day with no sector collection keeps the previous
 * amount. A shop left out of a later sector collection is omitted, and the
 * sheet prints a dash. Balances are not changed.
 */
export async function fetchSectorLastReceived(
  supabase: SupabaseClient,
  companyId: string,
  asOf: string,
  from?: string | null,
): Promise<SectorLastReceived[]> {
  const sector = await supabase.rpc("get_sector_last_received", {
    p_company_id: companyId,
    p_as_of: asOf,
    p_from: from || null,
  });
  if (!sector.error) return readRows(sector.data);

  const primary = await supabase.rpc("get_last_received_by_party", {
    p_company_id: companyId,
    p_as_of: asOf,
    p_from: null,
  });
  if (!primary.error) return readRows(primary.data);

  const fallback = await supabase.rpc("get_last_received_by_party", {
    p_company_id: companyId,
    p_as_of: asOf,
  });
  if (fallback.error) return [];
  return readRows(fallback.data);
}
