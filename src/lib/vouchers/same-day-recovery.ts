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
  if (!companyId || !partyId || !date) return [];
  const hits = new Map<string, SameDayRecovery>();

  if (await isAppOnline()) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("recoveries")
      .select("id, amount, remarks, created_at")
      .eq("company_id", companyId)
      .eq("party_id", partyId)
      .eq("recovery_date", date)
      .order("created_at", { ascending: false })
      .limit(20);
    if (!error) {
      for (const row of data || []) {
        const hit = toHit(row as Record<string, unknown>);
        if (hit) hits.set(hit.id, hit);
      }
    }
  }

  try {
    const cached = await getCachedRows("vouchers", companyId);
    for (const row of cached) {
      if (isCancelled(row) || !isRecoveryRow(row)) continue;
      if (!partyIds(row).has(partyId)) continue;
      const rowDay = day(row.recovery_date || row.voucher_date || row.doc_date);
      if (rowDay !== date) continue;
      const hit = toHit(row);
      if (hit && !hits.has(hit.id)) hits.set(hit.id, hit);
    }
  } catch {
    // Cache is optional. The live query is enough when the app is online.
  }

  return [...hits.values()];
}

export function formatRecoveryWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit" });
}
