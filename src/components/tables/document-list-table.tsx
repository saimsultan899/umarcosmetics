"use client";

import { ChartCard } from "@/components/analytics/chart-card";
import { DonutChart, TrendAreaChart } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { DocumentRowActions } from "@/components/tables/document-row-actions";
import { FilterChip } from "@/components/tables/filter-chip";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { groupSum, sumByDay } from "@/lib/analytics/aggregate";
import { useClientPagination } from "@/hooks/use-client-pagination";
import { formatPkr } from "@/lib/utils";
import { Banknote, CreditCard, FileText, ShoppingCart } from "lucide-react";
import { useMemo, useState } from "react";

export type DocumentListRow = {
  id: string;
  docNo: string;
  date: string;
  partyLabel: string;
  warehouseLabel?: string;
  paymentType?: string;
  total: number;
  href: string;
  table: string;
  linesTable: string;
  linesFk: string;
  extraFields?: Array<{ label: string; value: string }>;
};

export function DocumentListTable({
  title,
  rows,
  showPaymentFilter = false,
}: {
  title?: string;
  rows: DocumentListRow[];
  showPaymentFilter?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [payment, setPayment] = useState<"all" | "cash" | "credit" | "partial">(
    "all",
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (payment !== "all" && (r.paymentType || "") !== payment) return false;
      if (!q) return true;
      return [r.docNo, r.date, r.partyLabel, r.warehouseLabel, r.paymentType]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, query, payment]);

  const pager = useClientPagination(filtered);

  const totalAmount = filtered.reduce((s, r) => s + Number(r.total || 0), 0);
  const cashTotal = filtered
    .filter((r) => r.paymentType === "cash")
    .reduce((s, r) => s + Number(r.total || 0), 0);
  const creditTotal = filtered
    .filter((r) => r.paymentType === "credit" || r.paymentType === "partial")
    .reduce((s, r) => s + Number(r.total || 0), 0);

  const trend = sumByDay(
    filtered.map((r) => ({ date: r.date, amount: Number(r.total || 0) })),
    14,
  );
  const mix = groupSum(
    filtered.map((r) => ({
      key: String(r.paymentType || "n/a").toUpperCase(),
      amount: Number(r.total || 0),
    })),
  );

  return (
    <div className="space-y-6">
      <StatsGrid>
        <StatCard
          label="In filter"
          value={filtered.length}
          format="number"
          icon={FileText}
          hint={title || "Documents matching filter"}
        />
        <StatCard
          label="Total amount"
          value={totalAmount}
          format="money"
          icon={ShoppingCart}
          hint="Sum of filtered rows"
        />
        {showPaymentFilter ? (
          <>
            <button
              type="button"
              className="text-left"
              onClick={() => setPayment("cash")}
            >
              <StatCard
                label="Cash"
                value={cashTotal}
                format="money"
                icon={Banknote}
                tone={payment === "cash" ? "brand" : "ok"}
                hint="Click to filter table"
              />
            </button>
            <button
              type="button"
              className="text-left"
              onClick={() => setPayment("credit")}
            >
              <StatCard
                label="Credit / partial"
                value={creditTotal}
                format="money"
                icon={CreditCard}
                tone={payment === "credit" ? "brand" : "warn"}
                hint="Click to filter table"
              />
            </button>
          </>
        ) : (
          <StatCard
            label="Avg document"
            value={filtered.length ? totalAmount / filtered.length : 0}
            format="money"
            tone="neutral"
            hint="Average of filtered set"
          />
        )}
      </StatsGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Daily total"
          subtitle="Based on filtered documents"
        >
          <TrendAreaChart data={trend} valueLabel="Amount" />
        </ChartCard>
        {showPaymentFilter ? (
          <ChartCard title="Payment mix" subtitle="Filtered set">
            <DonutChart
              data={mix}
              centerValue={formatPkr(totalAmount)}
              centerLabel="Total"
            />
          </ChartCard>
        ) : (
          <ChartCard title="Summary" subtitle="Filtered amount">
            <div className="flex h-full min-h-[220px] flex-col justify-center gap-3">
              <p className="text-sm text-[var(--muted)]">Filtered total</p>
              <p className="font-[family-name:var(--font-display)] text-3xl font-semibold">
                {formatPkr(totalAmount)}
              </p>
              <p className="text-xs text-[var(--muted)]">
                {filtered.length} documents · page size adjustable below
              </p>
            </div>
          </ChartCard>
        )}
      </div>

      <div>
        <TableToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="Search doc #, party, date..."
          resultCount={filtered.length}
          totalCount={rows.length}
          filters={
            showPaymentFilter ? (
              <>
                {(
                  [
                    ["all", "All"],
                    ["cash", "Cash"],
                    ["credit", "Credit"],
                    ["partial", "Partial"],
                  ] as const
                ).map(([key, label]) => (
                  <FilterChip
                    key={key}
                    active={payment === key}
                    onClick={() => setPayment(key)}
                  >
                    {label}
                  </FilterChip>
                ))}
              </>
            ) : undefined
          }
        />

        <div className="table-shell">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Doc #</th>
                  <th>Date</th>
                  <th>Party</th>
                  <th>Warehouse</th>
                  {showPaymentFilter ? <th>Payment</th> : null}
                  <th>Total</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.slice.length ? (
                  pager.slice.map((inv) => (
                    <tr key={inv.id}>
                      <td className="font-medium">{inv.docNo}</td>
                      <td>{inv.date}</td>
                      <td>{inv.partyLabel}</td>
                      <td>{inv.warehouseLabel || "—"}</td>
                      {showPaymentFilter ? (
                        <td className="text-xs font-semibold uppercase">
                          {inv.paymentType || "—"}
                        </td>
                      ) : null}
                      <td>{formatPkr(inv.total)}</td>
                      <td>
                        <DocumentRowActions
                          title={inv.docNo}
                          href={inv.href}
                          table={inv.table}
                          id={inv.id}
                          linesTable={inv.linesTable}
                          linesFk={inv.linesFk}
                          fields={[
                            { label: "Doc #", value: inv.docNo },
                            { label: "Date", value: inv.date },
                            { label: "Party", value: inv.partyLabel },
                            {
                              label: "Warehouse",
                              value: inv.warehouseLabel || "—",
                            },
                            ...(inv.paymentType
                              ? [{ label: "Payment", value: inv.paymentType }]
                              : []),
                            { label: "Total", value: formatPkr(inv.total) },
                            ...(inv.extraFields || []),
                          ]}
                        />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={showPaymentFilter ? 7 : 6}
                      className="py-8 text-center text-[var(--muted)]"
                    >
                      No documents match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={pager.page}
            totalPages={pager.totalPages}
            pageSize={pager.pageSize}
            total={pager.total}
            from={pager.from}
            to={pager.to}
            onPageChange={pager.setPage}
            onPageSizeChange={pager.setPageSize}
          />
        </div>
      </div>
    </div>
  );
}
