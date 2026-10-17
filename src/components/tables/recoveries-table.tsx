"use client";

import { ExportButtons } from "@/components/reports/export-buttons";
import { TableScroll } from "@/components/tables/table-scroll";
import {
  stringOptions,
  TableFilterSelect,
} from "@/components/tables/table-filter-select";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { PostedDocumentEditor } from "@/components/trading/posted-document-editor";
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { useSearchInput, useUrlTableState } from "@/hooks/use-url-table-state";
import {
  fetchRecoveriesForExport,
  type RecoveryRow,
} from "@/lib/queries/recoveries";
import type { PaginationMeta } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/client";
import { formatPkr } from "@/lib/utils";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

export function RecoveriesTable({
  companyId,
  rows,
  pagination,
  cityOptions = [],
  sectorOptions = [],
  headOptions = [],
  salesmanOptions = [],
  amountTotal = 0,
  remainingTotal = 0,
  canCancel = true,
  onChanged,
}: {
  companyId: string;
  rows: RecoveryRow[];
  pagination: PaginationMeta;
  cityOptions?: string[];
  sectorOptions?: string[];
  headOptions?: string[];
  salesmanOptions?: { value: string; label: string }[];
  amountTotal?: number;
  remainingTotal?: number;
  canCancel?: boolean;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { q, isPending, setPage, setPageSize, setQuery, setFilter, filters } =
    useUrlTableState([
      "city",
      "sector",
      "head",
      "salesman",
      "fromDate",
      "toDate",
    ]);
  const search = useSearchInput(q, setQuery);
  const [exportRows, setExportRows] = useState<Record<string, unknown>[]>([]);
  const [exportLoading, setExportLoading] = useState(false);

  const pageAmountTotal = useMemo(
    () => rows.reduce((sum, r) => sum + Number(r.amount || 0), 0),
    [rows],
  );
  const pageRemainingTotal = useMemo(() => {
    const seen = new Set<string>();
    let sum = 0;
    for (const r of rows) {
      const key = r.party_id || r.id;
      if (seen.has(key)) continue;
      seen.add(key);
      sum += Number(r.remaining || 0);
    }
    return sum;
  }, [rows]);

  const displayAmountTotal = amountTotal || pageAmountTotal;
  const displayRemainingTotal = remainingTotal || pageRemainingTotal;

  const loadExport = useCallback(async () => {
    setExportLoading(true);
    try {
      const sp: Record<string, string | string[] | undefined> = {};
      searchParams.forEach((v, k) => {
        sp[k] = v;
      });
      const data = await fetchRecoveriesForExport(
        createClient(),
        companyId,
        sp,
      );
      setExportRows(data);
    } catch {
      const fallback = rows.map((r) => ({
        Date: r.recovery_date,
        Code: r.parties?.party_code || "",
        Customer: r.parties?.name_en || "",
        Head: r.parties?.head || "",
        City: r.city || "",
        Sector: r.route || "",
        Salesman: r.salesman?.full_name || "",
        Amount: r.amount,
        Remaining: r.remaining ?? "",
        Remarks: r.remarks || "",
      }));
      if (fallback.length) {
        fallback.push({
          Date: "",
          Code: "",
          Customer: "TOTAL",
          Head: "",
          City: "",
          Sector: "",
          Salesman: "",
          Amount: displayAmountTotal,
          Remaining: displayRemainingTotal,
          Remarks: "",
        });
      }
      setExportRows(fallback);
    } finally {
      setExportLoading(false);
    }
  }, [companyId, searchParams, rows, displayAmountTotal, displayRemainingTotal]);

  useEffect(() => {
    void loadExport();
  }, [loadExport]);

  async function cancelRecovery(row: RecoveryRow) {
    const supabase = createClient();
    const { error } = await supabase.rpc("cancel_recovery", {
      p_recovery_id: row.id,
    });
    if (error) {
      throw new Error(error.message);
    }
    onChanged?.();
  }

  const colSpan = 9;

  return (
    <div>
      <TableToolbar
        query={search.query}
        onQueryChange={search.onQueryChange}
        onFocus={search.onFocus}
        onBlur={search.onBlur}
        placeholder="Search customer, city, sector, head, remarks..."
        resultCount={pagination.total}
        totalCount={pagination.total}
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                From
              </span>
              <input
                type="date"
                value={filters.fromDate || ""}
                onChange={(e) => setFilter("fromDate", e.target.value || null)}
                className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
              />
            </label>
            <label className="inline-flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                To
              </span>
              <input
                type="date"
                value={filters.toDate || ""}
                onChange={(e) => setFilter("toDate", e.target.value || null)}
                className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
              />
            </label>
            {cityOptions.length ? (
              <TableFilterSelect
                label="City"
                value={filters.city || ""}
                options={stringOptions(cityOptions)}
                loading={isPending}
                onChange={(value) => setFilter("city", value)}
              />
            ) : null}
            {sectorOptions.length ? (
              <TableFilterSelect
                label="Sector"
                value={filters.sector || ""}
                options={stringOptions(sectorOptions)}
                loading={isPending}
                onChange={(value) => setFilter("sector", value)}
              />
            ) : null}
            {headOptions.length ? (
              <TableFilterSelect
                label="Head"
                value={filters.head || ""}
                options={stringOptions(headOptions)}
                loading={isPending}
                onChange={(value) => setFilter("head", value)}
              />
            ) : null}
            {salesmanOptions.length ? (
              <TableFilterSelect
                label="Salesman"
                value={filters.salesman || ""}
                options={salesmanOptions}
                loading={isPending}
                onChange={(value) => setFilter("salesman", value)}
              />
            ) : null}
            <div className="flex items-center gap-2">
              {exportLoading ? (
                <span className="text-[10px] text-[var(--muted)]">
                  Preparing export…
                </span>
              ) : null}
              <ExportButtons
                rows={exportRows}
                filename="recovery-history"
                title="Recovery history"
                printId="recovery-history-export"
              />
            </div>
          </div>
        }
      />
      <div className="table-shell">
        <TableScroll loading={isPending}>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Remaining</th>
                <th>Salesman</th>
                <th>City / Sector</th>
                <th>Head</th>
                <th>Remarks</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((r) => {
                  const party = r.parties
                    ? `${r.parties.party_code} — ${r.parties.name_en}`
                    : "—";
                  const salesman =
                    r.salesman?.full_name ||
                    (r.salesman_id ? "—" : "Unassigned");
                  const head = (r.parties?.head || "").trim() || "—";
                  const fields: DetailField[] = [
                    { label: "Date", value: r.recovery_date },
                    { label: "Customer", value: party },
                    { label: "Amount", value: formatPkr(r.amount) },
                    {
                      label: "Remaining",
                      value:
                        r.remaining == null ? "—" : formatPkr(r.remaining),
                    },
                    { label: "Salesman", value: salesman },
                    {
                      label: "City / Sector",
                      value:
                        [r.city, r.route].filter(Boolean).join(" · ") || "—",
                    },
                    { label: "Head", value: head },
                    { label: "Remarks", value: r.remarks || "—" },
                  ];
                  return (
                    <tr key={r.id}>
                      <td>{r.recovery_date}</td>
                      <td>{party}</td>
                      <td className="font-semibold text-emerald-700">
                        {formatPkr(r.amount)}
                      </td>
                      <td className="font-medium text-[var(--ink)]">
                        {r.remaining == null ? "—" : formatPkr(r.remaining)}
                      </td>
                      <td className="text-[var(--muted)]">{salesman}</td>
                      <td className="text-[var(--muted)]">
                        {[r.city, r.route].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="text-[var(--muted)]">{head}</td>
                      <td className="text-[var(--muted)]">
                        {r.remarks || "—"}
                      </td>
                      <td>
                        <RowActions
                          viewTitle="Recovery details"
                          viewFields={fields}
                          editTitle={`Edit recovery — ${party}`}
                          editClassName="sm:max-w-3xl"
                          allowEdit={canCancel}
                          editContent={
                            canCancel
                              ? (close) => (
                                  <PostedDocumentEditor
                                    table="recoveries"
                                    id={r.id}
                                    onDone={() => {
                                      close();
                                      onChanged?.();
                                      router.refresh();
                                    }}
                                  />
                                )
                              : undefined
                          }
                          allowCancel={false}
                          allowDelete={canCancel}
                          deleteTitle="Delete this recovery?"
                          deleteDescription={`Reverse ${formatPkr(r.amount)} for ${party}. The customer receivable goes back up by that amount.`}
                          deleteConfirmLabel="Delete entry"
                          onDelete={() => cancelRecovery(r)}
                        />
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={colSpan}
                    className="py-8 text-center text-[var(--muted)]"
                  >
                    No recoveries match this filter.
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length ? (
              <tfoot>
                <tr className="border-t-2 border-[var(--border)] bg-[var(--surface-2,var(--bg))] font-semibold">
                  <td colSpan={2}>Total ({pagination.total} entries)</td>
                  <td className="text-emerald-700">
                    {formatPkr(displayAmountTotal)}
                  </td>
                  <td>{formatPkr(displayRemainingTotal)}</td>
                  <td colSpan={5} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </TableScroll>
        <TablePagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          pageSize={pagination.pageSize}
          total={pagination.total}
          from={pagination.from}
          to={pagination.to}
          loading={isPending}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      {exportRows.length ? (
        <div
          className="print-sheet hidden print:block"
          data-print-id="recovery-history-export"
        >
          <h1 className="mb-2 text-lg font-semibold">Recovery history</h1>
          <p className="mb-3 text-xs text-[var(--muted)]">
            {Math.max(exportRows.length - 1, 0)} row(s) · Amount total{" "}
            {formatPkr(displayAmountTotal)} · Remaining total{" "}
            {formatPkr(displayRemainingTotal)} · printed{" "}
            {new Date().toLocaleString()}
          </p>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {Object.keys(exportRows[0] || {}).map((key) => (
                  <th
                    key={key}
                    className="border border-[var(--border)] px-1.5 py-1 text-left"
                  >
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {exportRows.map((row, idx) => {
                const isTotal = String(row.Customer || "") === "TOTAL";
                return (
                  <tr
                    key={idx}
                    className={isTotal ? "font-semibold" : undefined}
                  >
                    {Object.keys(exportRows[0] || {}).map((key) => (
                      <td
                        key={key}
                        className="border border-[var(--border)] px-1.5 py-1"
                      >
                        {row[key] == null || row[key] === ""
                          ? "—"
                          : String(row[key])}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
