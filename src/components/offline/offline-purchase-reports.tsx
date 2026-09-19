"use client";

import { FilterMultiSelect, ReportFilters } from "@/components/reports/report-filters";
import { ReportTable } from "@/components/reports/report-table";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { parseReportList } from "@/lib/reports/filter-params";
import {
  PURCHASE_REPORT_TYPES,
  type PurchaseReportType,
} from "@/lib/reports/purchases-data";
import { localDateIso, monthStartLocal } from "@/lib/dates";
import { getCachedRows } from "@/lib/offline/local-db";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

function today() {
  return localDateIso();
}

function monthStart() {
  return monthStartLocal();
}

const LINE_COMPANY_TYPES: PurchaseReportType[] = [
  "detail",
  "item_wise",
  "manufacturer_wise",
];

export function OfflinePurchaseReportsPage({
  companyId,
  companyName,
  searchParams: initialSp,
}: {
  companyId: string;
  companyName: string;
  searchParams?: {
    type?: string;
    from?: string;
    to?: string;
    warehouse?: string;
    party?: string;
    billFrom?: string;
    billTo?: string;
  };
}) {
  const urlSp = useSearchParams();

  const sp = useMemo(() => {
    return {
      type: urlSp.get("type") ?? initialSp?.type ?? undefined,
      from: urlSp.get("from") ?? initialSp?.from ?? undefined,
      to: urlSp.get("to") ?? initialSp?.to ?? undefined,
      warehouse: urlSp.get("warehouse") ?? initialSp?.warehouse ?? undefined,
      party: urlSp.get("party") ?? initialSp?.party ?? undefined,
      billFrom: urlSp.get("billFrom") ?? initialSp?.billFrom ?? undefined,
      billTo: urlSp.get("billTo") ?? initialSp?.billTo ?? undefined,
    };
  }, [urlSp, initialSp]);

  const from = sp.from || monthStart();
  const to = sp.to || today();

  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Record<string, unknown>[]>([]);
  const [parties, setParties] = useState<Record<string, unknown>[]>([]);
  const [warehouses, setWarehouses] = useState<Record<string, unknown>[]>([]);
  const [products, setProducts] = useState<Record<string, unknown>[]>([]);
  const [expiryClaims, setExpiryClaims] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      try {
        const {
          hasLocalSqlite,
          localListDocuments,
          localListMaster,
          localListByEntity,
        } = await import("@/lib/offline/sqlite-client");

        let invRows: Record<string, unknown>[] = [];
        let partyRows: Record<string, unknown>[] = [];
        let whRows: Record<string, unknown>[] = [];
        let prodRows: Record<string, unknown>[] = [];
        let expRows: Record<string, unknown>[] = [];

        if (hasLocalSqlite()) {
          try {
            const { localMigrateLegacyDocNos } = await import("@/lib/offline/sqlite-client");
            await localMigrateLegacyDocNos(companyId);
          } catch {}
        }
        try {
          const { migrateLegacyLocalDocNos } = await import("@/lib/offline/offline-submit");
          await migrateLegacyLocalDocNos(companyId);
        } catch {}

        if (hasLocalSqlite()) {
          const [invRes, partyRes, whRes, prodRes, expRes] = await Promise.all([
            localListDocuments("purchase_invoices", companyId, 2000),
            localListMaster("parties", companyId),
            localListMaster("warehouses", companyId),
            localListMaster("products", companyId),
            localListByEntity(companyId, "expiry_claim", 500),
          ]);
          invRows = invRes.rows || [];
          partyRows = partyRes.rows || [];
          whRows = whRes.rows || [];
          prodRows = prodRes.rows || [];
          expRows = expRes.rows || [];
        }

        // Complement from IndexedDB so offline includes 100% of cached server & local records
        const idbInvs = await getCachedRows("purchase_invoices", companyId);
        if (idbInvs.length) {
          const seen = new Set(invRows.map((r) => String(r.id || r._localId || r.invoice_no)));
          for (const row of idbInvs) {
            const k = String(row.id || row._localId || row.invoice_no);
            if (!seen.has(k)) {
              invRows.push(row);
              seen.add(k);
            }
          }
        }
        if (!partyRows.length) partyRows = await getCachedRows("parties", companyId);
        if (!whRows.length) whRows = await getCachedRows("warehouses", companyId);
        if (!prodRows.length) prodRows = await getCachedRows("products", companyId);
        if (!expRows.length) expRows = await getCachedRows("expiry_claims", companyId);

        if (cancelled) return;
        setInvoices(invRows);
        setParties(partyRows);
        setWarehouses(whRows);
        setProducts(prodRows);
        setExpiryClaims(expRows);
      } catch (err) {
        console.error("Failed to load local purchase report data:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const partyMap = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const p of parties) {
      if (p.id) map.set(String(p.id), p);
    }
    return map;
  }, [parties]);

  const whMap = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const w of warehouses) {
      if (w.id) map.set(String(w.id), w);
    }
    return map;
  }, [warehouses]);

  const prodMap = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const p of products) {
      if (p.id) map.set(String(p.id), p);
    }
    return map;
  }, [products]);

  const selectedTypes = parseReportList(sp.type) as PurchaseReportType[];
  const types: PurchaseReportType[] = selectedTypes.length ? selectedTypes : ["summary"];

  const warehouseIds = parseReportList(sp.warehouse);
  const partyIds = parseReportList(sp.party);

  const vendorParties = useMemo(() => {
    return parties.filter((p) => {
      const sub = String(p.party_subtype || p.party_type || "").toLowerCase();
      return sub === "supplier" || sub === "both" || sub === "vendor" || !sub;
    });
  }, [parties]);

  const reportSections = useMemo(() => {
    const filteredInvoices = invoices.filter((inv) => {
      const d = String(inv.invoice_date || "").slice(0, 10);
      if (d < from || d > to) return false;
      if (inv.status === "voided" || inv.status === "cancelled") return false;
      if (partyIds.length && !partyIds.includes(String(inv.party_id))) return false;
      return true;
    });

    function getInvoiceLines(inv: Record<string, unknown>): Record<string, unknown>[] {
      if (Array.isArray(inv.lines) && inv.lines.length) return inv.lines as Record<string, unknown>[];
      if (Array.isArray(inv.items) && inv.items.length) return inv.items as Record<string, unknown>[];
      if (Array.isArray(inv.purchase_invoice_items) && inv.purchase_invoice_items.length) return inv.purchase_invoice_items as Record<string, unknown>[];
      const p = inv.payload as Record<string, unknown> | undefined;
      if (p) {
        if (Array.isArray(p.lines) && p.lines.length) return p.lines as Record<string, unknown>[];
        if (Array.isArray(p.items) && p.items.length) return p.items as Record<string, unknown>[];
        if (Array.isArray(p.purchase_invoice_items) && p.purchase_invoice_items.length) return p.purchase_invoice_items as Record<string, unknown>[];
      }
      return [];
    }

    const sections: {
      type: PurchaseReportType;
      label: string;
      rows: Record<string, unknown>[];
    }[] = [];

    for (const type of types) {
      const label =
        PURCHASE_REPORT_TYPES.find((t) => t.key === type)?.label || "Purchase report";

      if (type === "expiry_claims") {
        const rows = expiryClaims
          .filter((c) => {
            const d = String(c.claim_date || c.doc_date || "").slice(0, 10);
            return d >= from && d <= to;
          })
          .map((c) => {
            const party = c.party_id ? partyMap.get(String(c.party_id)) : null;
            return {
              "Claim #": c.claim_no || c.doc_no || "",
              Date: c.claim_date || c.doc_date || "",
              Vendor: party ? `${party.party_code} — ${party.name_en}` : "Unknown",
              Total: Number(c.grand_total ?? c.amount ?? 0),
              _href: c.id ? `/expiry/claims/${c.id}` : "",
            };
          });
        sections.push({ type, label, rows });
        continue;
      }

      let list = [...filteredInvoices];

      if (warehouseIds.length && !LINE_COMPANY_TYPES.includes(type)) {
        list = list.filter((inv) => warehouseIds.includes(String(inv.warehouse_id)));
      }

      if (type === "bill_wise" && (sp.billFrom || sp.billTo)) {
        list = list.filter((inv) => {
          const no = String(inv.invoice_no || "");
          if (sp.billFrom && no < sp.billFrom) return false;
          if (sp.billTo && no > sp.billTo) return false;
          return true;
        });
      }

      list.sort((a, b) =>
        String(a.invoice_date || "").localeCompare(String(b.invoice_date || "")),
      );

      if (type === "supplier_wise") {
        const grouped = new Map<string, { bills: number; amount: number }>();
        for (const inv of list) {
          const party = inv.party_id ? partyMap.get(String(inv.party_id)) : null;
          const key = party ? `${party.party_code} — ${party.name_en}` : "Unassigned";
          const cur = grouped.get(key) || { bills: 0, amount: 0 };
          cur.bills += 1;
          cur.amount += Number(inv.grand_total || 0);
          grouped.set(key, cur);
        }
        const rows = [...grouped.entries()].map(([Vendor, v]) => ({
          Vendor,
          Bills: v.bills,
          Amount: v.amount,
        }));
        sections.push({ type, label, rows });
        continue;
      }

      if (type === "manufacturer_wise") {
        const grouped = new Map<string, { qty: number; amount: number }>();
        for (const inv of list) {
          const lines = getInvoiceLines(inv);
          for (const it of lines) {
            const prod = it.product_id ? prodMap.get(String(it.product_id)) : null;
            const wid = String(prod?.default_warehouse_id || inv.warehouse_id || "");
            if (warehouseIds.length && !warehouseIds.includes(wid)) continue;

            const wh = whMap.get(wid);
            const key = String(wh?.name || "Unassigned");
            const cur = grouped.get(key) || { qty: 0, amount: 0 };
            cur.qty += Number(it.qty || 0);
            cur.amount += Number(it.amount || 0);
            grouped.set(key, cur);
          }
        }
        const rows = [...grouped.entries()].map(([Company, v]) => ({
          Company,
          Qty: v.qty,
          Amount: v.amount,
        }));
        sections.push({ type, label, rows });
        continue;
      }

      if (type === "item_wise") {
        const rows: Record<string, unknown>[] = [];
        for (const inv of list) {
          const lines = getInvoiceLines(inv);
          const party = inv.party_id ? partyMap.get(String(inv.party_id)) : null;
          for (const it of lines) {
            const prod = it.product_id ? prodMap.get(String(it.product_id)) : null;
            const wid = String(prod?.default_warehouse_id || inv.warehouse_id || "");
            if (warehouseIds.length && !warehouseIds.includes(wid)) continue;

            rows.push({
              Date: inv.invoice_date,
              Invoice: inv.invoice_no,
              Vendor: party ? `${party.party_code} — ${party.name_en}` : "",
              Code: it.product_code || prod?.code,
              Item: it.product_name || prod?.name_en,
              Qty: Number(it.qty || 0),
              Rate: Number(it.rate || it.purchase_price || 0),
              Amount: Number(it.amount || 0),
              _href: inv.id ? `/purchases/invoices/${inv.id}` : "",
            });
          }
        }
        sections.push({ type, label, rows });
        continue;
      }

      // summary or bill_wise
      const rows = list.map((inv) => {
        const party = inv.party_id ? partyMap.get(String(inv.party_id)) : null;
        return {
          Date: inv.invoice_date,
          Invoice: inv.invoice_no,
          "Supplier Bill #": inv.supplier_bill_no || "—",
          Vendor: party ? `${party.party_code} — ${party.name_en}` : "",
          City: inv.city || party?.city || "",
          Subtotal: Number(inv.subtotal || inv.grand_total || 0),
          Discount: Number(inv.discount_total || 0),
          "Extra discount": Number(inv.extra_discount || 0),
          Total: Number(inv.grand_total || 0),
          _href: `/purchases/invoices/${inv.id}`,
        };
      });
      sections.push({ type, label, rows });
    }

    return sections;
  }, [
    invoices,
    parties,
    warehouses,
    products,
    expiryClaims,
    partyMap,
    whMap,
    prodMap,
    types,
    from,
    to,
    warehouseIds,
    partyIds,
    sp.billFrom,
    sp.billTo,
  ]);

  if (loading) {
    return (
      <div className="animate-rise space-y-6">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Purchase Reports
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Vendor and item purchase analytics with export
          </p>
        </div>
        <PageSkeleton />
      </div>
    );
  }

  return (
    <div className="animate-rise space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          Purchase Reports
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Vendor and item purchase analytics with export
        </p>
      </div>

      <ReportFilters
        action="/reports/purchases"
        defaults={{ from, to, type: types.join(",") }}
        typeOptions={PURCHASE_REPORT_TYPES}
        extras={
          <>
            <FilterMultiSelect
              name="warehouse"
              label="Company"
              value={sp.warehouse}
              options={warehouses.map((w) => ({
                value: String(w.id),
                label: String(w.name || ""),
              }))}
            />
            <FilterMultiSelect
              name="party"
              label="Vendor"
              value={sp.party}
              options={vendorParties.map((p) => ({
                value: String(p.id),
                label: `${p.party_code} — ${p.name_en}`,
              }))}
            />
            {types.includes("bill_wise") ? (
              <>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
                    Bill from
                  </label>
                  <input
                    name="billFrom"
                    defaultValue={sp.billFrom || ""}
                    className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
                    Bill to
                  </label>
                  <input
                    name="billTo"
                    defaultValue={sp.billTo || ""}
                    className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
                  />
                </div>
              </>
            ) : null}
          </>
        }
      />

      {reportSections.map((section) => (
        <section
          key={section.type}
          className="space-y-3 border-t border-[var(--border)] pt-6 first:border-t-0 first:pt-0"
        >
          <ReportTable
            title={section.label}
            companyName={companyName}
            subtitle={`${from} to ${to} · ${section.rows.length} rows`}
            rows={section.rows}
            filename={`purchase-${section.type}-${from}-${to}`}
          />
        </section>
      ))}
    </div>
  );
}
