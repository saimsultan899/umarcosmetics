"use client";

import { TablePagination } from "@/components/tables/table-pagination";
import { TableScroll } from "@/components/tables/table-scroll";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { RowActions } from "@/components/ui/row-actions";
import { expenseCategoryLabel } from "@/lib/expenses/categories";
import { useUrlTableState } from "@/hooks/use-url-table-state";
import type { ExpenseRow } from "@/lib/queries/expenses";
import type { PaginationMeta } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/client";
import { formatPkr } from "@/lib/utils";
import { useEffect, useState } from "react";

export function ExpensesTable({
  expenses,
  pagination,
}: {
  expenses: ExpenseRow[];
  pagination: PaginationMeta;
}) {
  const { q, isPending, setPage, setPageSize, setQuery } = useUrlTableState();
  const [localQuery, setLocalQuery] = useState(q);

  useEffect(() => {
    setLocalQuery(q);
  }, [q]);

  async function remove(id: string) {
    const supabase = createClient();
    const { error } = await supabase.rpc("delete_expense", { p_id: id });
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
        placeholder="Search EXP no or remarks..."
        resultCount={pagination.total}
        totalCount={pagination.total}
      />
      <div className="table-shell">
        <TableScroll loading={isPending}>
          <table>
            <thead>
              <tr>
                <th>No.</th>
                <th>Date</th>
                <th>Type</th>
                <th>Salesman / Company</th>
                <th>Vendor</th>
                <th>Amount</th>
                <th>Remarks</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {expenses.length ? (
                expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="font-medium">{e.expense_no}</td>
                    <td>{e.expense_date}</td>
                    <td>{expenseCategoryLabel(e.category)}</td>
                    <td className="text-[var(--muted)]">
                      {e.salesman_name || e.warehouse_name || "—"}
                    </td>
                    <td className="text-[var(--muted)]">
                      {e.vendor_name || "—"}
                    </td>
                    <td>{formatPkr(e.amount)}</td>
                    <td className="text-[var(--muted)]">{e.remarks || "—"}</td>
                    <td>
                      <RowActions
                        viewTitle={`${e.expense_no} — ${expenseCategoryLabel(e.category)}`}
                        viewFields={[
                          { label: "No.", value: e.expense_no },
                          { label: "Date", value: e.expense_date },
                          {
                            label: "Type",
                            value: expenseCategoryLabel(e.category),
                          },
                          { label: "Salesman", value: e.salesman_name || "—" },
                          { label: "Company", value: e.warehouse_name || "—" },
                          { label: "Vendor", value: e.vendor_name || "—" },
                          { label: "Amount", value: formatPkr(e.amount) },
                          { label: "Remarks", value: e.remarks || "—" },
                        ]}
                        href={`/vouchers/expenses/${e.id}`}
                        allowEdit={false}
                        allowDelete
                        onDelete={() => remove(e.id)}
                        deleteTitle={`Delete ${e.expense_no}?`}
                        deleteDescription="This removes the expense and reverses its ledger entry."
                      />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={8}
                    className="py-10 text-center text-[var(--muted)]"
                  >
                    No expenses yet. Click Add expense to record salary or a
                    daily cost.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableScroll>
      </div>
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
  );
}
