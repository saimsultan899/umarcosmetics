import { createClient } from "@/lib/supabase/client";
import { getCachedRows, listPendingMutations } from "@/lib/offline/local-db";
import type { DocumentListRow } from "@/lib/queries/documents";
import { formatReportInvNo } from "@/lib/reports/helpers";

/** Stable id for one new sale invoice attempt (survives retries and offline sync). */
export function createSaleClientRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sale-req-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** After a network error, check whether the server already posted this sale. */
export async function findSaleInvoiceIdByClientRequest(
  companyId: string,
  clientRequestId: string,
): Promise<string | null> {
  if (!clientRequestId) return null;
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("sale_invoices")
      .select("id")
      .eq("company_id", companyId)
      .eq("client_request_id", clientRequestId)
      .maybeSingle();
    if (error || !data?.id) return null;
    return String(data.id);
  } catch {
    return null;
  }
}

function partyLabelFromPayload(payload: Record<string, unknown>): string {
  const parties = payload.parties as
    | { party_code?: string; name_en?: string }
    | null
    | undefined;
  const code = String(payload.party_code || parties?.party_code || "").trim();
  const name = String(payload.party_name || parties?.name_en || "").trim();
  if (code && name) return `${code} — ${name}`;
  return name || code || "—";
}

/** Pending local sale invoices for the online list (Chrome + desktop). */
export async function loadPendingSaleInvoiceListRows(
  companyId: string,
): Promise<DocumentListRow[]> {
  const rows: DocumentListRow[] = [];
  const seen = new Set<string>();

  try {
    const pending = await listPendingMutations(companyId);
    for (const m of pending) {
      if (m.type !== "sale_invoice") continue;
      const payload = m.payload || {};
      const id = String(payload.id || m.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const rawDocNo = String(
        m.localId || payload.invoice_no || payload.doc_no || "Pending",
      );
      const docNo = formatReportInvNo(rawDocNo) || rawDocNo;
      rows.push({
        id,
        docNo,
        date: String(payload.invoice_date || ""),
        partyLabel: partyLabelFromPayload(payload),
        warehouseLabel: "—",
        paymentType: String(payload.payment_type || ""),
        total: Number(payload.grand_total) || 0,
        href: `/sales/invoices/${id}`,
        table: "sale_invoices",
        linesTable: "sale_invoice_items",
        linesFk: "sale_invoice_id",
        syncPending: true,
      });
    }
  } catch {
    /* ignore */
  }

  try {
    const cached = await getCachedRows("sale_invoices", companyId);
    for (const r of cached) {
      const sync = String(
        (r as { _syncStatus?: string })._syncStatus || r.sync_status || "",
      ).toLowerCase();
      if (sync !== "pending") continue;
      const id = String(r.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const rawDocNo = String(r.invoice_no || r._localId || id);
      const docNo = formatReportInvNo(rawDocNo) || rawDocNo;
      rows.push({
        id,
        docNo,
        date: String(r.invoice_date || ""),
        partyLabel: partyLabelFromPayload(r as Record<string, unknown>),
        warehouseLabel: "—",
        paymentType: String(r.payment_type || ""),
        total: Number(r.grand_total) || 0,
        href: `/sales/invoices/${id}`,
        table: "sale_invoices",
        linesTable: "sale_invoice_items",
        linesFk: "sale_invoice_id",
        syncPending: true,
      });
    }
  } catch {
    /* ignore */
  }

  return rows.sort((a, b) => b.date.localeCompare(a.date));
}
