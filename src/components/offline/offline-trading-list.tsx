"use client";

import { DocumentListTable } from "@/components/tables/document-list-table";
import { SaleInvoiceForm } from "@/components/trading/sale-invoice-form";
import { PurchaseInvoiceForm } from "@/components/trading/purchase-invoice-form";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useOfflineData } from "@/hooks/use-offline-data";
import { emptyDocumentSummary } from "@/lib/offline/local-list-meta";
import { offlineStockSnapshot } from "@/lib/offline/offline-reports";
import { migrateLegacyLocalDocNos } from "@/lib/offline/offline-submit";
import { formatReportInvNo } from "@/lib/reports/helpers";
import type { CacheStoreName } from "@/lib/offline/local-db";
import type { DocumentListRow } from "@/lib/queries/documents";
import type { Party, Product, Warehouse } from "@/lib/types/database";
import type { PaginationMeta } from "@/lib/pagination";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type Kind = "sale" | "purchase";

const STORE: Record<Kind, CacheStoreName> = {
  sale: "sale_invoices",
  purchase: "purchase_invoices",
};

function paginate<T>(items: T[], page: number, pageSize: number): { paged: T[]; meta: PaginationMeta } {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const validPage = Math.min(Math.max(1, page), totalPages);
  const from = total ? (validPage - 1) * pageSize : 0;
  const to = Math.min(total, from + pageSize);
  const paged = items.slice(from, to);
  return {
    paged,
    meta: {
      page: validPage,
      pageSize: pageSize as 12 | 24 | 48 | 96,
      total,
      totalPages,
      from: total ? from + 1 : 0,
      to,
    },
  };
}

/** Same UI as online sale/purchase invoice pages — with full search, filter & pagination on local data. */
export function OfflineTradingListPage({
  kind,
  companyId,
  organizationId,
}: {
  kind: Kind;
  companyId: string;
  organizationId: string;
}) {
  const title = kind === "sale" ? "Sale Invoice" : "Purchase Invoice";
  const description =
    kind === "sale"
      ? "Post counter / credit sales and deduct stock."
      : "Post supplier bills and increase stock.";

  const searchParams = useSearchParams();
  const q = (searchParams.get("q") || "").toLowerCase().trim();
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const rawSize = Number(searchParams.get("pageSize") || 24);
  const pageSize = [12, 24, 48, 96].includes(rawSize) ? (rawSize as 12 | 24 | 48 | 96) : 24;
  const paymentFilter = (searchParams.get("payment") || "all").toLowerCase();
  const warehouseFilter = searchParams.get("warehouse") || "";

  const { data: invoiceRows, loading, refetch: refetchInvoices } = useOfflineData(STORE[kind], companyId);
  const { data: parties } = useOfflineData<Party>("parties", companyId);
  const { data: products } = useOfflineData<Product>("products", companyId);
  const { data: warehouses } = useOfflineData<Warehouse>("warehouses", companyId);
  const { data: salesmenRows } = useOfflineData("salesmen", companyId);
  const [stockRows, setStockRows] = useState<
    Array<{ product_id: string; warehouse_id: string; qty: number }>
  >([]);

  const refreshStock = useCallback(() => {
    void offlineStockSnapshot(companyId).then((rows) => {
      setStockRows(
        rows.map((r) => ({
          product_id: String(r.product_id || ""),
          warehouse_id: String(r.warehouse_id || ""),
          qty: Number(r.qty) || 0,
        })),
      );
    });
  }, [companyId]);

  useEffect(() => {
    refreshStock();
  }, [refreshStock]);

  const handleCreated = useCallback(() => {
    void refetchInvoices();
    refreshStock();
  }, [refetchInvoices, refreshStock]);

  const salesmen = useMemo(
    () =>
      salesmenRows.map((s) => ({
        user_id: String(s.id),
        full_name: String(s.full_name || s.name || "") || null,
        phone: s.phone == null ? null : String(s.phone),
      })),
    [salesmenRows],
  );

  const warehouseMap = useMemo(
    () => new Map(warehouses.map((w) => [w.id, w.name])),
    [warehouses],
  );

  const partyMap = useMemo(
    () => new Map(parties.map((p) => [p.id, p.name_en || p.name_ur || ""])),
    [parties],
  );

  useEffect(() => {
    void (async () => {
      try {
        const { hasLocalSqlite, localMigrateLegacyDocNos } = await import(
          "@/lib/offline/sqlite-client"
        );
        if (hasLocalSqlite()) {
          await localMigrateLegacyDocNos(companyId);
        }
      } catch {}
      await migrateLegacyLocalDocNos(companyId);
      await refetchInvoices();
    })();
  }, [companyId, refetchInvoices]);

  const listRows: (DocumentListRow & { warehouseId?: string })[] = useMemo(
    () =>
      invoiceRows.map((r) => {
        const warehouseId = String(r.warehouse_id || "");
        const warehouseName =
          (r.warehouses as { name?: string } | undefined)?.name ||
          warehouseMap.get(warehouseId) ||
          r.warehouse_name ||
          "";
        const rawDocNo = String(r.invoice_no || r._localId || r.id);
        const docNo = formatReportInvNo(rawDocNo) || rawDocNo;
        return {
          id: String(r.id),
          docNo,
          date: String(r.invoice_date || ""),
          partyLabel: String(
            (r.parties as { name_en?: string } | undefined)?.name_en ||
              partyMap.get(String(r.party_id || "")) ||
              r.party_name ||
              "",
          ),
          warehouseLabel: String(warehouseName),
          warehouseId,
          paymentType: String(r.payment_type || ""),
          total: Number(r.grand_total) || 0,
          href:
            kind === "sale"
              ? `/sales/invoices/${r.id}`
              : `/purchases/invoices/${r.id}`,
          table: kind === "sale" ? "sale_invoices" : "purchase_invoices",
          linesTable:
            kind === "sale" ? "sale_invoice_lines" : "purchase_invoice_lines",
          linesFk:
            kind === "sale" ? "sale_invoice_id" : "purchase_invoice_id",
        };
      }),
    [invoiceRows, kind, warehouseMap, partyMap],
  );

  // Filter rows based on search, payment, and warehouse
  const filteredRows = useMemo(() => {
    return listRows.filter((r) => {
      if (paymentFilter !== "all") {
        const p = (r.paymentType || "").toLowerCase();
        if (paymentFilter === "cash" && p !== "cash") return false;
        if (paymentFilter === "credit" && p !== "credit") return false;
        if (paymentFilter === "partial" && p !== "partial") return false;
      }
      if (warehouseFilter && r.warehouseId !== warehouseFilter) {
        return false;
      }
      if (q) {
        const text = `${r.docNo} ${r.partyLabel} ${r.warehouseLabel} ${r.paymentType}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [listRows, paymentFilter, warehouseFilter, q]);

  // Sliced page items
  const { paged, meta: paginationMeta } = useMemo(
    () => paginate(filteredRows, page, pageSize),
    [filteredRows, page, pageSize],
  );

  // Live Summary from filtered set
  const summary = useMemo(() => {
    const totalAmount = filteredRows.reduce((s, r) => s + (r.total || 0), 0);
    const cashTotal = filteredRows
      .filter((r) => String(r.paymentType).toLowerCase() === "cash")
      .reduce((s, r) => s + (r.total || 0), 0);
    const creditTotal = Math.max(0, totalAmount - cashTotal);

    // Trend by date (last 14 days)
    const dayMap = new Map<string, number>();
    for (const r of filteredRows) {
      if (!r.date) continue;
      const d = r.date.slice(0, 10);
      dayMap.set(d, (dayMap.get(d) || 0) + (r.total || 0));
    }
    const trend = Array.from(dayMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14)
      .map(([name, value]) => ({ name, value }));

    const mix = [
      { name: "Cash", value: cashTotal },
      { name: "Credit", value: creditTotal },
    ].filter((m) => m.value > 0);

    return {
      ...emptyDocumentSummary(totalAmount),
      cashTotal,
      creditTotal,
      trend,
      mix,
    };
  }, [filteredRows]);

  const canCreate =
    parties.length > 0 && products.length > 0 && warehouses.length > 0;

  if (loading) {
    return (
      <div className="animate-rise space-y-6">
        <PageHeading title={title} description={description} />
        <PageSkeleton />
      </div>
    );
  }

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title={title}
        description={description}
        actions={
          <CreateDialogButton
            label={kind === "sale" ? "New sale" : "New purchase"}
            title={kind === "sale" ? "New sale invoice" : "New purchase invoice"}
            description={
              kind === "sale"
                ? "Post a sale and deduct company stock"
                : "Post a purchase and add company stock"
            }
            size="xl"
            disabled={!canCreate}
            disabledHint="Add at least one customer, product, and company first."
          >
            {kind === "sale" ? (
              <SaleInvoiceForm
                companyId={companyId}
                organizationId={organizationId}
                parties={parties}
                products={products}
                warehouses={warehouses}
                stockBalances={stockRows}
                salesmen={salesmen}
                onDone={handleCreated}
              />
            ) : (
              <PurchaseInvoiceForm
                companyId={companyId}
                organizationId={organizationId}
                parties={parties}
                products={products}
                warehouses={warehouses}
                onDone={handleCreated}
              />
            )}
          </CreateDialogButton>
        }
      />

      <DocumentListTable
        title={kind === "sale" ? "Sale invoices" : "Purchase invoices"}
        rows={paged}
        pagination={paginationMeta}
        summary={summary}
        showPaymentFilter={kind === "sale"}
        showPrint
        warehouses={warehouses}
      />
    </div>
  );
}
