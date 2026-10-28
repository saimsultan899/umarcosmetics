import { getCachedRows } from "@/lib/offline/local-db";
import { isAppOnline } from "@/lib/offline/local-auth";
import { createClient } from "@/lib/supabase/client";

export type SameDayRecovery = {
  id: string;
  amount: number;
  at: string;
  remarks: string;
};

function num(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function day(value: unknown) {
  return String(value || "").slice(0, 10);
}

function isCancelled(row: Record<string, unknown>) {
  return String(row.status || "posted") === "cancelled";
}

function partyIds(row: Record<string, unknown>) {
  const ids = new Set<string>();
  if (row.party_id) ids.add(String(row.party_id));
  const lines = row.voucher_lines;
  if (Array.isArray(lines)) {
    for (const line of lines) {
      const partyId = (line as { party_id?: string }).party_id;
      if (partyId) ids.add(String(partyId));
    }
  }
  return ids;
}

function isRecoveryRow(row: Record<string, unknown>) {
  if (row.recovery_date && row.party_id && !row.voucher_type) return true;
  const type = String(row.voucher_type || row.type || row.entity_type || "");
  return type === "CR" || type === "recovery" || type === "cash_receipt";
}

function toHit(row: Record<string, unknown>): SameDayRecovery | null {
  const amount = num(row.amount || row.total_amount || row.grand_total);
  if (!(amount > 0)) return null;
  return {
    id: String(row.id || row._localId || `${row.party_id}-${row.created_at}-${amount}`),
    amount,
    at: String(row.created_at || ""),
    remarks: String(row.remarks || row.narration || ""),
  };
}

/** Posted recoveries for one customer on one date, online and from the local cache. */
export async function findSameDayRecoveries(
  companyId: string,
  partyId: string,
  date: string,
): Promise<SameDayRecovery[]> {
  const map = await findSameDayRecoveriesByParties(companyId, [partyId], date);
  return map.get(partyId) || [];
}

/**
 * One query for every shop on a sector recording.
 * Avoids 30–50 sequential network calls before Record.
 */
export async function findSameDayRecoveriesByParties(
  companyId: string,
  partyIdList: string[],
  date: string,
): Promise<Map<string, SameDayRecovery[]>> {
  const out = new Map<string, SameDayRecovery[]>();
  const partyIdsUnique = [...new Set(partyIdList.filter(Boolean))];
  if (!companyId || !date || !partyIdsUnique.length) return out;

  function push(partyId: string, hit: SameDayRecovery) {
    const list = out.get(partyId) || [];
    if (list.some((row) => row.id === hit.id)) return;
    list.push(hit);
    out.set(partyId, list);
  }

  if (await isAppOnline()) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("recoveries")
      .select("id, party_id, amount, remarks, created_at")
      .eq("company_id", companyId)
      .eq("recovery_date", date)
      .in("party_id", partyIdsUnique)
      .order("created_at", { ascending: false })
      .limit(Math.min(5000, partyIdsUnique.length * 20));
    if (!error) {
      for (const row of data || []) {
        const partyId = String(row.party_id || "");
        if (!partyId) continue;
        const hit = toHit(row as Record<string, unknown>);
        if (hit) push(partyId, hit);
      }
    }
  }

  try {
    const wanted = new Set(partyIdsUnique);
    const cached = await getCachedRows("vouchers", companyId);
    for (const row of cached) {
      if (isCancelled(row) || !isRecoveryRow(row)) continue;
      const rowDay = day(row.recovery_date || row.voucher_date || row.doc_date);
      if (rowDay !== date) continue;
      for (const partyId of partyIds(row)) {
        if (!wanted.has(partyId)) continue;
        const hit = toHit(row);
        if (hit) push(partyId, hit);
      }
    }
  } catch {
    // Cache is optional. The live query is enough when the app is online.
  }

  return out;
}

export function formatRecoveryWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit" });
}
