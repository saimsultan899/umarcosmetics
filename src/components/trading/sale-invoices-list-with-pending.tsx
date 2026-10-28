"use client";

import { DocumentListTable } from "@/components/tables/document-list-table";
import { useSyncStatus } from "@/components/offline/sync-provider";
import { loadPendingSaleInvoiceListRows } from "@/lib/trading/sale-invoice-submit";
import type {
  DocumentListRow,
  DocumentListSummary,
} from "@/lib/queries/documents";
import type { PaginationMeta } from "@/lib/pagination";
import type { EditedSaleRef } from "@/lib/trading/edited-sales";
import { formatPkr } from "@/lib/utils";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

export function SaleInvoicesListWithPending({
  companyId,
  serverRows,
  pagination,
  summary,
  warehouses,
  sectors = [],
  editedSales = [],
}: {
  companyId: string;
  serverRows: DocumentListRow[];
  pagination: PaginationMeta;
  summary: DocumentListSummary;
  warehouses: Array<{ id: string; name: string }>;
  sectors?: string[];
  editedSales?: EditedSaleRef[];
}) {
  const sync = useSyncStatus();
  const [pendingRows, setPendingRows] = useState<DocumentListRow[]>([]);

  const refreshPending = useCallback(() => {
    void loadPendingSaleInvoiceListRows(companyId).then(setPendingRows);
  }, [companyId]);

  useEffect(() => {
    refreshPending();
  }, [refreshPending, sync?.pending?.total, sync?.lastSync, sync?.lastResult]);

  const serverIds = useMemo(
    () => new Set(serverRows.map((r) => r.id)),
    [serverRows],
  );

  const pendingOnly = useMemo(
    () => pendingRows.filter((r) => !serverIds.has(r.id)),
    [pendingRows, serverIds],
  );

  return (
    <div className="space-y-4">
      {pendingOnly.length > 0 ? (
        <div
          className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm"
          role="status"
        >
          <p className="font-semibold text-amber-900 dark:text-amber-100">
            {pendingOnly.length} sale invoice
            {pendingOnly.length === 1 ? "" : "s"} waiting to sync
          </p>
          <p className="mt-1 text-[var(--muted)]">
            Saved on this device while the connection was unstable. They will post
            to the server when sync runs — do not re-enter the same bill.
          </p>
          <ul className="mt-2 space-y-1">
            {pendingOnly.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  href={row.href}
                  className="font-medium text-[var(--brand)] hover:underline"
                >
                  {row.docNo}
                </Link>
                <span className="text-[var(--muted)]">{row.date}</span>
                <span>{row.partyLabel}</span>
                <span className="font-medium">{formatPkr(row.total)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <DocumentListTable
        title="Sale invoices"
        rows={serverRows}
        pagination={pagination}
        summary={summary}
        showPaymentFilter
        showPrint
        enableBatchPrint
        showCompanyColumn={false}
        showSectorColumn
        warehouses={warehouses}
        sectors={sectors}
        editedSales={editedSales}
      />
    </div>
  );
}
