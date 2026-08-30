"use client";

import { TableScroll } from "@/components/tables/table-scroll";
import {
  stringOptions,
  TableFilterSelect,
} from "@/components/tables/table-filter-select";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { useUrlTableState } from "@/hooks/use-url-table-state";
import type { RecoveryRow } from "@/lib/queries/recoveries";
import type { PaginationMeta } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/client";
import { formatPkr } from "@/lib/utils";
import { useEffect, useState } from "react";

export function RecoveriesTable({
  rows,
  pagination,
  cityOptions = [],
  sectorOptions = [],
  salesmanOptions = [],
}: {
  rows: RecoveryRow[];
  pagination: PaginationMeta;
  cityOptions?: string[];
  sectorOptions?: string[];
  salesmanOptions?: { value: string; label: string }[];
}) {
  const { q, isPending, setPage, setPageSize, setQuery, setFilter, filters } =
    useUrlTableState(["city", "sector", "salesman"]);
  const [localQuery, setLocalQuery] = useState(q);

  useEffect(() => {
    setLocalQuery(q);
  }, [q]);

  async function remove(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("recoveries").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  return (
    <div>
      <TableToolbar
        query={localQuery}
        onQueryChange={(value) => {
          setLocalQuery(value);
          setQuery(value);
        }}
        loading={isPending}
        placeholder="Search party, city, sector, remarks..."
        resultCount={pagination.total}
        totalCount={pagination.total}
        filters={
          <div className="flex flex-wrap items-center gap-2">
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
            {salesmanOptions.length ? (
              <TableFilterSelect
                label="Salesman"
                value={filters.salesman || ""}
                options={salesmanOptions}
                loading={isPending}
                onChange={(value) => setFilter("salesman", value)}
              />
            ) : null}
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
                <th>Salesman</th>
                <th>City / Sector</th>
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
                  const salesman = r.salesman?.full_name || (r.salesman_id ? "—" : "Unassigned");
                  const fields: DetailField[] = [
                    { label: "Date", value: r.recovery_date },
                    { label: "Customer", value: party },
                    { label: "Amount", value: formatPkr(r.amount) },
                    { label: "Salesman", value: salesman },
                    {
                      label: "City / Sector",
                      value:
                        [r.city, r.route].filter(Boolean).join(" · ") || "—",
                    },
                    { label: "Remarks", value: r.remarks || "—" },
                  ];
                  return (
                    <tr key={r.id}>
                      <td>{r.recovery_date}</td>
                      <td>{party}</td>
                      <td className="font-semibold text-emerald-700">
                        {formatPkr(r.amount)}
                      </td>
                      <td className="text-[var(--muted)]">{salesman}</td>
                      <td className="text-[var(--muted)]">
                        {[r.city, r.route].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="text-[var(--muted)]">{r.remarks || "—"}</td>
                      <td>
                        <RowActions
                          viewTitle="Recovery details"
                          viewFields={fields}
                          allowEdit={false}
                          deleteTitle="Delete recovery?"
                          deleteDescription="This permanently removes the recovery entry."
                          onDelete={() => remove(r.id)}
                        />
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[var(--muted)]">
                    No recoveries yet.
                  </td>
                </tr>
              )}
            </tbody>
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
    </div>
  );
}
