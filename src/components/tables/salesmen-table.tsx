"use client";

import { SalesmanForm } from "@/components/salesman/salesman-form";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableScroll } from "@/components/tables/table-scroll";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { useClientPagination } from "@/hooks/use-client-pagination";
import { createClient } from "@/lib/supabase/client";
import { formatNumber, formatPkr } from "@/lib/utils";
import { HandCoins, ScrollText, ShoppingCart, TrendingUp, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

export type SalesmanListRow = {
  id: string;
  full_name: string;
  phone: string | null;
  code: string | null;
  is_active: boolean;
  user_id: string | null;
  created_at: string;
  bills: number;
  sales: number;
  recoveries: number;
  recovered: number;
};

export function SalesmenTable({
  rows,
  companyId,
  organizationId,
}: {
  rows: SalesmanListRow[];
  companyId: string;
  organizationId: string;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      [r.full_name, r.phone, r.code]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term)),
    );
  }, [rows, query]);

  const pager = useClientPagination(filtered);

  const totals = useMemo(
    () =>
      rows.reduce(
        (a, r) => {
          a.bills += r.bills;
          a.sales += r.sales;
          a.recoveries += r.recoveries;
          a.recovered += r.recovered;
          return a;
        },
        { bills: 0, sales: 0, recoveries: 0, recovered: 0 },
      ),
    [rows],
  );

  async function deactivate(id: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("salesmen")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }

  function fields(r: SalesmanListRow): DetailField[] {
    return [
      { label: "Name", value: r.full_name },
      { label: "Phone", value: r.phone || "—" },
      { label: "Code", value: r.code || "—" },
      { label: "Login", value: r.user_id ? "Has login" : "No login" },
      { label: "Status", value: r.is_active ? "Active" : "Inactive" },
      { label: "Sale bills", value: formatNumber(r.bills, 0) },
      { label: "Sale amount", value: formatPkr(r.sales) },
      { label: "Recoveries", value: formatNumber(r.recoveries, 0) },
      { label: "Recovered", value: formatPkr(r.recovered) },
      {
        label: "Added",
        value: r.created_at ? r.created_at.slice(0, 10) : "—",
      },
    ];
  }

  return (
    <div className="space-y-6">
      <StatsGrid>
        <StatCard
          label="Salesmen"
          value={rows.length}
          format="number"
          icon={Users}
          hint="Active field staff names"
        />
        <StatCard
          label="Tagged sales"
          value={totals.sales}
          format="money"
          icon={ShoppingCart}
          tone="brand"
          hint={`${formatNumber(totals.bills, 0)} bills linked`}
        />
        <StatCard
          label="Tagged recoveries"
          value={totals.recovered}
          format="money"
          icon={HandCoins}
          tone="ok"
          hint={`${formatNumber(totals.recoveries, 0)} collections linked`}
        />
      </StatsGrid>

      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search name, phone, code..."
        resultCount={filtered.length}
        totalCount={rows.length}
      />

      <div className="table-shell">
        <TableScroll>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Login</th>
                <th className="text-right">Bills</th>
                <th className="text-right">Sales</th>
                <th className="text-right">Recoveries</th>
                <th className="text-right">Recovered</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pager.slice.length ? (
                pager.slice.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">{r.full_name}</td>
                    <td>{r.phone || "—"}</td>
                    <td>
                      <span
                        className={
                          r.user_id
                            ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700"
                            : "rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs font-semibold text-[var(--muted)]"
                        }
                      >
                        {r.user_id ? "Has login" : "No login"}
                      </span>
                    </td>
                    <td className="text-right tabular-nums">{r.bills}</td>
                    <td className="text-right tabular-nums">
                      {formatPkr(r.sales)}
                    </td>
                    <td className="text-right tabular-nums">{r.recoveries}</td>
                    <td className="text-right tabular-nums">
                      {formatPkr(r.recovered)}
                    </td>
                    <td>
                      <div className="flex flex-nowrap items-center justify-end gap-0.5">
                        <Link
                          href={`/sales/salesmen?salesman=${r.id}`}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--brand)] hover:bg-[var(--brand-soft)]"
                          aria-label="Sales report"
                          title="Sales report"
                        >
                          <TrendingUp className="h-3.5 w-3.5" />
                        </Link>
                        <Link
                          href={`/reports/salesman-ledger?salesman=${r.id}`}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--brand)] hover:bg-[var(--brand-soft)]"
                          aria-label="Ledger"
                          title="Ledger"
                        >
                          <ScrollText className="h-3.5 w-3.5" />
                        </Link>
                        <RowActions
                          viewTitle={r.full_name}
                          viewFields={fields(r)}
                          editTitle={`Edit ${r.full_name}`}
                          deleteTitle={`Remove ${r.full_name}?`}
                          deleteDescription="This hides the salesman from dropdowns. Past sale and recovery records stay linked for reports."
                          allowEdit
                          allowDelete
                          onDelete={() => deactivate(r.id)}
                          editContent={(close) => (
                            <SalesmanForm
                              companyId={companyId}
                              organizationId={organizationId}
                              initial={{
                                id: r.id,
                                full_name: r.full_name,
                                phone: r.phone,
                                code: r.code,
                              }}
                              onDone={close}
                            />
                          )}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={8}
                    className="py-10 text-center text-[var(--muted)]"
                  >
                    {rows.length
                      ? "No salesmen match this search."
                      : "No salesmen yet. Click Add salesman."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableScroll>
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
  );
}
