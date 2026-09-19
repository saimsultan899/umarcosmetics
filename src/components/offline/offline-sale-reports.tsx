"use client";

import { ChartCard } from "@/components/analytics/chart-card";
import { CompareBarChart } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { CashFlowSalesPrint } from "@/components/reports/cash-flow-sales-print";
import { PartyWiseSalesPrint } from "@/components/reports/party-wise-sales-print";
import { FilterMultiSelect, ReportFilters } from "@/components/reports/report-filters";
import { FilterFlagPill } from "@/components/reports/report-type-pills";
import { ReportTable } from "@/components/reports/report-table";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { parseReportList } from "@/lib/reports/filter-params";
import {
  formatReportDate,
  formatReportInvNo,
  one,
} from "@/lib/reports/helpers";
import {
  SALE_REPORT_TYPES,
  type SaleReportType,
} from "@/lib/reports/sales-data";
import { localDateIso, monthStartLocal } from "@/lib/dates";
import { getCachedRows } from "@/lib/offline/local-db";
import { FileSpreadsheet, Rows3 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

function today() {
  return localDateIso();
}

function monthStart() {
  return monthStartLocal();
}

function distinctSorted(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = (raw || "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

const LINE_COMPANY_TYPES: SaleReportType[] = [
  "party_wise",
  "item_wise",
  "manufacturer_wise",
  "sale_profit",
  "cash_flow",
];

export function OfflineSaleReportsPage({
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
    sector?: string;
    city?: string;
    billFrom?: string;
    billTo?: string;
    walkin?: string;
  };
}) {
  const urlSp = useSearchParams();

  // Read params from URL search params with fallback to initial props
  const sp = useMemo(() => {
    return {
      type: urlSp.get("type") ?? initialSp?.type ?? undefined,
      from: urlSp.get("from") ?? initialSp?.from ?? undefined,
      to: urlSp.get("to") ?? initialSp?.to ?? undefined,
      warehouse: urlSp.get("warehouse") ?? initialSp?.warehouse ?? undefined,
      party: urlSp.get("party") ?? initialSp?.party ?? undefined,
      sector: urlSp.get("sector") ?? initialSp?.sector ?? undefined,
      city: urlSp.get("city") ?? initialSp?.city ?? undefined,
      billFrom: urlSp.get("billFrom") ?? initialSp?.billFrom ?? undefined,
      billTo: urlSp.get("billTo") ?? initialSp?.billTo ?? undefined,
      walkin: urlSp.get("walkin") ?? initialSp?.walkin ?? undefined,
    };
  }, [urlSp, initialSp]);

  const from = sp.from || monthStart();
  const to = sp.to || today();

  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Record<string, unknown>[]>([]);
  const [parties, setParties] = useState<Record<string, unknown>[]>([]);
  const [warehouses, setWarehouses] = useState<Record<string, unknown>[]>([]);
  const [products, setProducts] = useState<Record<string, unknown>[]>([]);
  const [salesmen, setSalesmen] = useState<Record<string, unknown>[]>([]);
  const [expiryReceipts, setExpiryReceipts] = useState<Record<string, unknown>[]>([]);

  // Load offline data from SQLite / IndexedDB
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
        let smRows: Record<string, unknown>[] = [];
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
          const [invRes, partyRes, whRes, prodRes, smRes, expRes] = await Promise.all([
            localListDocuments("sale_invoices", companyId, 2000),
            localListMaster("parties", companyId),
            localListMaster("warehouses", companyId),
            localListMaster("products", companyId),
            localListMaster("salesmen", companyId),
            localListByEntity(companyId, "expiry_receipt", 500),
          ]);
          invRows = invRes.rows || [];
          partyRows = partyRes.rows || [];
          whRows = whRes.rows || [];
          prodRows = prodRes.rows || [];
          smRows = smRes.rows || [];
          expRows = expRes.rows || [];
        }

        // Complement from IndexedDB so offline includes 100% of cached server & local records
        const idbInvs = await getCachedRows("sale_invoices", companyId);
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
        if (!smRows.length) smRows = await getCachedRows("salesmen", companyId);
        if (!expRows.length) expRows = await getCachedRows("expiry_receipts", companyId);

        if (cancelled) return;
        setInvoices(invRows);
        setParties(partyRows);
        setWarehouses(whRows);
        setProducts(prodRows);
        setSalesmen(smRows);
        setExpiryReceipts(expRows);
      } catch (err) {
        console.error("Failed to load local sales report data:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  // Index maps for instant O(1) joins
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

  const smMap = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const s of salesmen) {
      if (s.id) map.set(String(s.id), s);
    }
    return map;
  }, [salesmen]);

  const walkInParty = useMemo(() => {
    return parties.find(
      (p) => String(p.party_code || "").toUpperCase() === "WALKIN",
    );
  }, [parties]);

  const selectedTypes = parseReportList(sp.type) as SaleReportType[];
  const types: SaleReportType[] = selectedTypes.length ? selectedTypes : ["date_wise"];
  const primaryType = types[0];

  const warehouseIds = parseReportList(sp.warehouse);
  const partyIds = parseReportList(sp.party);
  const sectors = parseReportList(sp.sector);
  const cities = parseReportList(sp.city);
  const walkInOnly = sp.walkin === "1" || sp.walkin === "true";

  const brandName = warehouseIds.length
    ? warehouses
        .filter((w) => warehouseIds.includes(String(w.id)))
        .map((w) => String(w.name || ""))
        .join(", ") || "All"
    : "All";

  const sectorOptions = useMemo(() => {
    return distinctSorted(
      parties.map((p) => (p.route ? String(p.route) : null)),
    );
  }, [parties]);

  const cityOptions = useMemo(() => {
    return distinctSorted(
      parties.map((p) => (p.city || p.head ? String(p.city || p.head) : null)),
    );
  }, [parties]);

  // Build report sections
  const reportSections = useMemo(() => {
    // 1. Filter invoices for the date range and company
    const filteredInvoices = invoices.filter((inv) => {
      const invDate = String(inv.invoice_date || "").slice(0, 10);
      if (invDate < from || invDate > to) return false;
      if (inv.status === "voided" || inv.status === "cancelled") return false;

      // Party filter
      if (walkInOnly) {
        if (!walkInParty) return false;
        if (String(inv.party_id) !== String(walkInParty.id)) return false;
      } else if (partyIds.length) {
        if (!partyIds.includes(String(inv.party_id))) return false;
      }

      // Party details for route/city checks
      const party = inv.party_id ? partyMap.get(String(inv.party_id)) : null;
      const route = String(inv.route || party?.route || "");
      const city = String(inv.city || party?.city || party?.head || "");

      if (sectors.length && !sectors.includes(route)) return false;
      if (cities.length && !cities.includes(city)) return false;

      return true;
    });

    // Helper to get lines from invoice
    function getInvoiceLines(inv: Record<string, unknown>): Record<string, unknown>[] {
      if (Array.isArray(inv.lines) && inv.lines.length) return inv.lines as Record<string, unknown>[];
      if (Array.isArray(inv.items) && inv.items.length) return inv.items as Record<string, unknown>[];
      if (Array.isArray(inv.sale_invoice_items) && inv.sale_invoice_items.length) return inv.sale_invoice_items as Record<string, unknown>[];
      const p = inv.payload as Record<string, unknown> | undefined;
      if (p) {
        if (Array.isArray(p.lines) && p.lines.length) return p.lines as Record<string, unknown>[];
        if (Array.isArray(p.items) && p.items.length) return p.items as Record<string, unknown>[];
        if (Array.isArray(p.sale_invoice_items) && p.sale_invoice_items.length) return p.sale_invoice_items as Record<string, unknown>[];
      }
      return [];
    }

    const sections: {
      type: SaleReportType;
      label: string;
      rows: Record<string, unknown>[];
    }[] = [];

    for (const type of types) {
      const label =
        SALE_REPORT_TYPES.find((t) => t.key === type)?.label || "Sale report";

      if (type === "expiry_credits") {
        const rows = expiryReceipts
          .filter((r) => {
            const d = String(r.receipt_date || r.doc_date || "").slice(0, 10);
            return d >= from && d <= to;
          })
          .map((r) => {
            const party = r.party_id ? partyMap.get(String(r.party_id)) : null;
            return {
              Date: formatReportDate(String(r.receipt_date || r.doc_date || "")),
              "Receipt No.": formatReportInvNo(String(r.receipt_no || r.doc_no || "")),
              Customer: party ? `${party.party_code} — ${party.name_en}` : "Unknown",
              Total: Number(r.grand_total ?? r.amount ?? 0),
              _href: r.id ? `/expiry/receipts/${r.id}` : "",
            };
          });
        sections.push({ type, label, rows });
        continue;
      }

      let list = [...filteredInvoices];

      // Warehouse filter for non-line company types
      if (warehouseIds.length && !LINE_COMPANY_TYPES.includes(type)) {
        list = list.filter((inv) => warehouseIds.includes(String(inv.warehouse_id)));
      }

      if (type === "cash_sales") {
        list = list.filter((inv) => String(inv.payment_type).toLowerCase() === "cash");
      }
      if (type === "credit_sales") {
        list = list.filter((inv) => {
          const pt = String(inv.payment_type).toLowerCase();
          return pt === "credit" || pt === "partial";
        });
      }
      if (type === "bill_range" && (sp.billFrom || sp.billTo)) {
        list = list.filter((inv) => {
          const no = String(inv.invoice_no || "");
          if (sp.billFrom && no < sp.billFrom) return false;
          if (sp.billTo && no > sp.billTo) return false;
          return true;
        });
      }

      // Sort by invoice_date
      list.sort((a, b) =>
        String(a.invoice_date || "").localeCompare(String(b.invoice_date || "")),
      );

      if (type === "party_wise") {
        const detail: Record<string, unknown>[] = [];
        for (const inv of list) {
          const lines = getInvoiceLines(inv);
          const party = inv.party_id ? partyMap.get(String(inv.party_id)) : null;
          const partyName = String(party?.name_en || "Unknown").toUpperCase();
          const routePart = party?.route || party?.head;
          const partyLine = [
            party?.party_code,
            party?.address,
            party?.city,
            routePart ? `( ${routePart} ) RANGE` : null,
          ]
            .filter(Boolean)
            .join(" ");

          if (!lines.length) {
            const wid = String(inv.warehouse_id || "");
            if (warehouseIds.length && !warehouseIds.includes(wid)) continue;

            detail.push({
              Date: formatReportDate(String(inv.invoice_date || "")),
              "Inv No.": formatReportInvNo(String(inv.invoice_no || "")),
              "Item No": "-",
              ItemName: "TOTAL SALE",
              Qty: 1,
              Price: Number(inv.grand_total || 0),
              Amount: Number(inv.grand_total || 0),
              _sort_date: String(inv.invoice_date || ""),
              _party_id: String(inv.party_id || party?.party_code || "unknown"),
              _party_name: partyName,
              _party_line: partyLine,
              _href: inv.id ? `/sales/invoices/${inv.id}` : "",
            });
            continue;
          }

          for (const it of lines) {
            const prod = it.product_id ? prodMap.get(String(it.product_id)) : null;
            const wid = String(prod?.default_warehouse_id || inv.warehouse_id || "");
            if (warehouseIds.length && !warehouseIds.includes(wid)) continue;

            detail.push({
              Date: formatReportDate(String(inv.invoice_date || "")),
              "Inv No.": formatReportInvNo(String(inv.invoice_no || "")),
              "Item No": it.product_code || prod?.code || "",
              ItemName: String(it.product_name || prod?.name_en || "").toUpperCase(),
              Qty: Number(it.qty || 0),
              Price: Number(it.rate || it.sale_price || 0),
              Amount: Number(it.amount || 0),
              _sort_date: String(inv.invoice_date || ""),
              _party_id: String(inv.party_id || party?.party_code || "unknown"),
              _party_name: partyName,
              _party_line: partyLine,
              _href: inv.id ? `/sales/invoices/${inv.id}` : "",
            });
          }
        }
        detail.sort((a, b) => {
          const pCmp = String(a._party_name).localeCompare(String(b._party_name));
          if (pCmp) return pCmp;
          const dCmp = String(a._sort_date).localeCompare(String(b._sort_date));
          if (dCmp) return dCmp;
          return String(a["Inv No."]).localeCompare(String(b["Inv No."]));
        });
        sections.push({ type, label, rows: detail });
        continue;
      }

      if (type === "cash_flow") {
        type InvBucket = {
          invoiceId: string;
          date: string;
          invoiceNo: string;
          paymentType: string;
          amount: number;
          cash: number;
          credit: number;
        };
        type PartyBucket = {
          partyId: string;
          partyCode: string;
          partyName: string;
          invoices: Map<string, InvBucket>;
          amount: number;
        };
        type CompanyBucket = {
          warehouseId: string;
          companyName: string;
          parties: Map<string, PartyBucket>;
          amount: number;
        };

        const companiesMap = new Map<string, CompanyBucket>();

        for (const inv of list) {
          const lines = getInvoiceLines(inv);
          const party = inv.party_id ? partyMap.get(String(inv.party_id)) : null;
          const partyId = String(inv.party_id || "unknown");
          const billTotal = Number(inv.grand_total || 0);
          const paid = Number(inv.amount_paid || 0);

          if (!lines.length) {
            const wid = String(inv.warehouse_id || "unknown");
            if (warehouseIds.length && !warehouseIds.includes(wid)) continue;

            const wh = whMap.get(wid);
            const compName = (String(wh?.name || "Unknown Company")).toUpperCase();
            const lineAmount = billTotal;
            const cashShare = paid;
            const creditShare = lineAmount - cashShare;

            let cBucket = companiesMap.get(wid);
            if (!cBucket) {
              cBucket = { warehouseId: wid, companyName: compName, parties: new Map(), amount: 0 };
              companiesMap.set(wid, cBucket);
            }

            let pBucket = cBucket.parties.get(partyId);
            if (!pBucket) {
              pBucket = {
                partyId,
                partyCode: String(party?.party_code || ""),
                partyName: String(party?.name_en || "Unknown").toUpperCase(),
                invoices: new Map(),
                amount: 0,
              };
              cBucket.parties.set(partyId, pBucket);
            }

            const invKey = String(inv.id || "");
            let iBucket = pBucket.invoices.get(invKey);
            if (!iBucket) {
              iBucket = {
                invoiceId: invKey,
                date: String(inv.invoice_date || ""),
                invoiceNo: String(inv.invoice_no || ""),
                paymentType: String(inv.payment_type || "credit"),
                amount: 0,
                cash: 0,
                credit: 0,
              };
              pBucket.invoices.set(invKey, iBucket);
            }

            iBucket.amount += lineAmount;
            iBucket.cash += cashShare;
            iBucket.credit += creditShare;
            pBucket.amount += lineAmount;
            cBucket.amount += lineAmount;
            continue;
          }

          for (const it of lines) {
            const prod = it.product_id ? prodMap.get(String(it.product_id)) : null;
            const wid = String(prod?.default_warehouse_id || inv.warehouse_id || "unknown");
            if (warehouseIds.length && !warehouseIds.includes(wid)) continue;

            const wh = whMap.get(wid);
            const compName = (String(wh?.name || "Unknown Company")).toUpperCase();
            const lineAmount = Number(it.amount || 0);
            const cashShare = billTotal > 0 ? (lineAmount / billTotal) * paid : 0;
            const creditShare = lineAmount - cashShare;

            let cBucket = companiesMap.get(wid);
            if (!cBucket) {
              cBucket = { warehouseId: wid, companyName: compName, parties: new Map(), amount: 0 };
              companiesMap.set(wid, cBucket);
            }

            let pBucket = cBucket.parties.get(partyId);
            if (!pBucket) {
              pBucket = {
                partyId,
                partyCode: String(party?.party_code || ""),
                partyName: String(party?.name_en || "Unknown").toUpperCase(),
                invoices: new Map(),
                amount: 0,
              };
              cBucket.parties.set(partyId, pBucket);
            }

            const invKey = String(inv.id || "");
            let iBucket = pBucket.invoices.get(invKey);
            if (!iBucket) {
              iBucket = {
                invoiceId: invKey,
                date: String(inv.invoice_date || ""),
                invoiceNo: String(inv.invoice_no || ""),
                paymentType: String(inv.payment_type || "credit"),
                amount: 0,
                cash: 0,
                credit: 0,
              };
              pBucket.invoices.set(invKey, iBucket);
            }

            iBucket.amount += lineAmount;
            iBucket.cash += cashShare;
            iBucket.credit += creditShare;
            pBucket.amount += lineAmount;
            cBucket.amount += lineAmount;
          }
        }

        const rows: Record<string, unknown>[] = [];
        const sortedCompanies = [...companiesMap.values()].sort((a, b) =>
          a.companyName.localeCompare(b.companyName),
        );
        for (const comp of sortedCompanies) {
          const topParties = [...comp.parties.values()].sort((a, b) => b.amount - a.amount);
          topParties.forEach((p, rank) => {
            const invs = [...p.invoices.values()].sort((a, b) => {
              const d = a.date.localeCompare(b.date);
              if (d) return d;
              return a.invoiceNo.localeCompare(b.invoiceNo);
            });
            for (const inv of invs) {
              rows.push({
                Date: formatReportDate(inv.date),
                "Inv No.": formatReportInvNo(inv.invoiceNo),
                Type: String(inv.paymentType || "").toUpperCase(),
                "Sale amount": Math.round(inv.amount * 100) / 100,
                "Cash received": Math.round(inv.cash * 100) / 100,
                "Credit balance": Math.round(inv.credit * 100) / 100,
                _company: comp.companyName,
                _company_amount: comp.amount,
                _party_id: p.partyId,
                _party_code: p.partyCode,
                _party_name: p.partyName,
                _party_amount: p.amount,
                _party_rank: rank + 1,
                _href: `/sales/invoices/${inv.invoiceId}`,
                _sort_date: inv.date,
              });
            }
          });
        }
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
              Customer: party ? `${party.party_code} — ${party.name_en}` : "",
              Code: it.product_code || prod?.code,
              Item: it.product_name || prod?.name_en,
              Qty: Number(it.qty || 0),
              Rate: Number(it.rate || it.sale_price || 0),
              Discount: Number(it.discount || 0),
              Amount: Number(it.amount || 0),
              _href: inv.id ? `/sales/invoices/${inv.id}` : "",
            });
          }
        }
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

      if (type === "sale_profit") {
        const rows: Record<string, unknown>[] = [];
        for (const inv of list) {
          const lines = getInvoiceLines(inv);
          for (const it of lines) {
            const prod = it.product_id ? prodMap.get(String(it.product_id)) : null;
            const wid = String(prod?.default_warehouse_id || inv.warehouse_id || "");
            if (warehouseIds.length && !warehouseIds.includes(wid)) continue;

            const cost = Number(prod?.purchase_rate || prod?.purchase_price || 0) * Number(it.qty || 0);
            const sale = Number(it.amount || 0);
            rows.push({
              Date: inv.invoice_date,
              Invoice: inv.invoice_no,
              Item: it.product_name || prod?.name_en,
              Qty: Number(it.qty || 0),
              "Sale amount": sale,
              "Est. cost": cost,
              Profit: sale - cost,
              _href: inv.id ? `/sales/invoices/${inv.id}` : "",
            });
          }
        }
        sections.push({ type, label, rows });
        continue;
      }

      if (type === "city_wise") {
        const grouped = new Map<string, { bills: number; amount: number }>();
        for (const inv of list) {
          const party = inv.party_id ? partyMap.get(String(inv.party_id)) : null;
          const key = String(inv.city || party?.city || party?.head || "No city");
          const cur = grouped.get(key) || { bills: 0, amount: 0 };
          cur.bills += 1;
          cur.amount += Number(inv.grand_total || 0);
          grouped.set(key, cur);
        }
        const rows = [...grouped.entries()].map(([City, v]) => ({
          City,
          Bills: v.bills,
          Amount: v.amount,
        }));
        sections.push({ type, label, rows });
        continue;
      }

      if (type === "route_wise") {
        const grouped = new Map<string, { bills: number; amount: number }>();
        for (const inv of list) {
          const party = inv.party_id ? partyMap.get(String(inv.party_id)) : null;
          const key = String(inv.route || party?.route || "No sector");
          const cur = grouped.get(key) || { bills: 0, amount: 0 };
          cur.bills += 1;
          cur.amount += Number(inv.grand_total || 0);
          grouped.set(key, cur);
        }
        const rows = [...grouped.entries()].map(([Sector, v]) => ({
          Sector,
          Bills: v.bills,
          Amount: v.amount,
        }));
        sections.push({ type, label, rows });
        continue;
      }

      if (type === "salesman_wise") {
        const grouped = new Map<string, { bills: number; amount: number }>();
        for (const inv of list) {
          const sm = inv.salesman_id ? smMap.get(String(inv.salesman_id)) : null;
          const key = String(sm?.full_name || "Unassigned");
          const cur = grouped.get(key) || { bills: 0, amount: 0 };
          cur.bills += 1;
          cur.amount += Number(inv.grand_total || 0);
          grouped.set(key, cur);
        }
        const rows = [...grouped.entries()].map(([Salesman, v]) => ({
          Salesman,
          Bills: v.bills,
          Amount: v.amount,
        }));
        sections.push({ type, label, rows });
        continue;
      }

      // Default / date_wise
      const rows = list.map((inv) => {
        const party = inv.party_id ? partyMap.get(String(inv.party_id)) : null;
        return {
          Date: inv.invoice_date,
          Invoice: inv.invoice_no,
          Customer: party ? `${party.party_code} — ${party.name_en}` : "",
          Payment: inv.payment_type,
          City: inv.city || party?.city || "",
          Sector: inv.route || party?.route || "",
          Subtotal: Number(inv.subtotal || inv.grand_total || 0),
          "Trade discount": Number(inv.discount_total || 0),
          "Extra discount": Number(inv.extra_discount || 0),
          Total: Number(inv.grand_total || 0),
          Paid: Number(inv.amount_paid || 0),
          _href: `/sales/invoices/${inv.id}`,
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
    salesmen,
    expiryReceipts,
    partyMap,
    whMap,
    prodMap,
    smMap,
    walkInParty,
    types,
    from,
    to,
    warehouseIds,
    partyIds,
    sectors,
    cities,
    sp.billFrom,
    sp.billTo,
    walkInOnly,
  ]);

  const rows = reportSections.find((s) => s.type === primaryType)?.rows || [];
  const activeLabel =
    types.length === 1
      ? reportSections[0]?.label || "Sale report"
      : `${types.length} reports selected`;

  const primaryMoneyKey = useMemo(() => {
    if (!rows.length) return null;
    const keys = Object.keys(rows[0]);
    const priority = ["Amount", "Total", "Grand total", "Profit", "Invoice total", "Sale amount"];
    for (const p of priority) {
      const found = keys.find(
        (k) => k.toLowerCase() === p.toLowerCase() && typeof rows[0][k] === "number",
      );
      if (found) return found;
    }
    return null;
  }, [rows]);

  const numericTotal = useMemo(() => {
    if (!primaryMoneyKey) return 0;
    return rows.reduce((sum, row) => sum + Number(row[primaryMoneyKey] || 0), 0);
  }, [rows, primaryMoneyKey]);

  const chartSample = useMemo(() => {
    return rows.slice(0, 8).map((row, idx) => {
      const label = String(
        row.Date ||
          row.Customer ||
          row.Party ||
          row.Salesman ||
          row.City ||
          row.Sector ||
          row.Product ||
          row.Company ||
          row.Invoice ||
          `Row ${idx + 1}`,
      ).slice(0, 18);
      const value = primaryMoneyKey ? Number(row[primaryMoneyKey] || 0) : 0;
      return { name: label, value };
    });
  }, [rows, primaryMoneyKey]);

  if (loading) {
    return (
      <div className="animate-rise space-y-6">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Sale Reports
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Filtered sales analytics with print / Excel / PDF export
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
          Sale Reports
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Filtered sales analytics with print / Excel / PDF export
        </p>
      </div>

      <StatsGrid>
        <StatCard
          label="Report rows"
          value={rows.length}
          format="number"
          icon={Rows3}
          hint={activeLabel}
        />
        <StatCard
          label="Highlighted total"
          value={numericTotal}
          format="money"
          icon={FileSpreadsheet}
          tone="brand"
          hint="Sum of main amount columns in this view"
        />
        <StatCard
          label="From"
          value={from}
          tone="neutral"
          hint="Period start"
        />
        <StatCard
          label="To"
          value={to}
          tone="neutral"
          hint="Period end"
        />
      </StatsGrid>

      {chartSample.some((x) => x.value > 0) ? (
        <ChartCard
          title={`${activeLabel} snapshot`}
          subtitle="Visual preview of the first rows — full detail in table below"
        >
          <CompareBarChart data={chartSample} valueLabel="Amount" height={240} />
        </ChartCard>
      ) : null}

      <ReportFilters
        action="/reports/sales"
        defaults={{ from, to, type: types.join(","), walkin: walkInOnly ? "1" : "" }}
        typeOptions={SALE_REPORT_TYPES}
        typeExtras={
          <FilterFlagPill
            name="walkin"
            label="Walk-in customer"
            value={walkInOnly ? "1" : ""}
          />
        }
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
              label="Customer"
              value={sp.party}
              options={parties.map((p) => ({
                value: String(p.id),
                label: `${p.party_code} — ${p.name_en}`,
              }))}
            />
            <FilterMultiSelect
              name="sector"
              label="Sector"
              value={sp.sector}
              options={sectorOptions.map((s) => ({ value: s, label: s }))}
            />
            <FilterMultiSelect
              name="city"
              label="Head / City"
              value={sp.city}
              options={cityOptions.map((c) => ({ value: c, label: c }))}
            />
            {types.includes("bill_range") ? (
              <>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
                    Bill from
                  </label>
                  <input
                    name="billFrom"
                    defaultValue={sp.billFrom || ""}
                    className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
                    placeholder="SI-0001"
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
                    placeholder="SI-9999"
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
          {section.type === "party_wise" ? (
            <PartyWiseSalesPrint
              companyName={companyName}
              brandName={brandName}
              from={from}
              to={to}
              rows={section.rows}
              filename={`sale-${section.type}-${from}-${to}`}
            />
          ) : section.type === "cash_flow" ? (
            <CashFlowSalesPrint
              companyName={companyName}
              brandName={brandName}
              from={from}
              to={to}
              rows={section.rows}
              filename={`sale-${section.type}-${from}-${to}`}
            />
          ) : (
            <ReportTable
              title={section.label}
              companyName={companyName}
              brandName={brandName}
              subtitle={`${from} to ${to} · ${section.rows.length} rows`}
              rows={section.rows}
              filename={`sale-${section.type}-${from}-${to}`}
            />
          )}
        </section>
      ))}
    </div>
  );
}
