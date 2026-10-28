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
 * A one-shop day clears the rest of the sector only when a later receipt
 * exists after it. The latest day, when it is a single shop, does not.
 * A shop that missed that round is omitted, and the sheet prints a dash.
 * Balances are not changed.
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

/**
 * Last received for the edit sheet: ignore the voucher being edited, and ignore
 * any later same-day receipts so Received and Last received are not mixed.
 */
export async function fetchLastReceivedBeforeVoucher(
  supabase: SupabaseClient,
  companyId: string,
  asOf: string,
  exclude: { voucherId: string; at?: string | null },
): Promise<SectorLastReceived[]> {
  const asOfDay = asOf.slice(0, 10);
  const { data, error } = await supabase
    .from("recoveries")
    .select("id, party_id, amount, recovery_date, created_at, voucher_id")
    .eq("company_id", companyId)
    .lte("recovery_date", asOfDay)
    .gt("amount", 0)
    .order("recovery_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error || !data?.length) {
    return fetchSectorLastReceived(supabase, companyId, asOfDay);
  }

  type Agg = {
    partyId: string;
    amount: number;
    receivedDate: string;
    receivedAt: string;
    recoveryId: string;
  };
  const groups = new Map<string, Agg>();
  for (const row of data) {
    const partyId = String(row.party_id || "");
    if (!partyId) continue;
    const voucherKey = row.voucher_id
      ? String(row.voucher_id)
      : String(row.id);
    if (voucherKey === exclude.voucherId) continue;

    const receivedDate = String(row.recovery_date || "").slice(0, 10);
    const receivedAt = String(row.created_at || "");
    if (
      exclude.at &&
      receivedDate === asOfDay &&
      receivedAt &&
      receivedAt > exclude.at
    ) {
      continue;
    }

    const key = `${partyId}:${voucherKey}`;
    const amount = Number(row.amount || 0);
    if (!(amount > 0)) continue;
    const prev = groups.get(key);
    if (!prev) {
      groups.set(key, {
        partyId,
        amount,
        receivedDate,
        receivedAt,
        recoveryId: String(row.id),
      });
    } else {
      prev.amount += amount;
      if (receivedAt > prev.receivedAt) {
        prev.receivedAt = receivedAt;
        prev.recoveryId = String(row.id);
        prev.receivedDate = receivedDate;
      }
    }
  }

  const byParty = new Map<string, SectorLastReceived>();
  const sorted = [...groups.values()].sort((a, b) => {
    const byDate = b.receivedDate.localeCompare(a.receivedDate);
    if (byDate) return byDate;
    return b.receivedAt.localeCompare(a.receivedAt);
  });
  for (const g of sorted) {
    if (byParty.has(g.partyId)) continue;
    byParty.set(g.partyId, {
      partyId: g.partyId,
      amount: g.amount,
      receivedDate: g.receivedDate,
      receivedAt: g.receivedAt,
      recoveryId: g.recoveryId,
    });
  }
  return [...byParty.values()];
}
