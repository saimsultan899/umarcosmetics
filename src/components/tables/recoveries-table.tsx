"use client";

import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { useClientPagination } from "@/hooks/use-client-pagination";
import { createClient } from "@/lib/supabase/client";
import { formatPkr } from "@/lib/utils";
import { useMemo, useState } from "react";

type RecoveryRow = {
  id: string;
  recovery_date: string;
  amount: number;
  city: string | null;
  route: string | null;
  remarks: string | null;
  parties?: { party_code: string; name_en: string } | null;
};

export function RecoveriesTable({ rows }: { rows: RecoveryRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const party = r.parties
        ? `${r.parties.party_code} ${r.parties.name_en}`
        : "";
      return [r.recovery_date, party, r.city, r.route, r.remarks, r.amount]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, query]);

  const pager = useClientPagination(filtered);

  async function remove(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("recoveries").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  return (
    <div>
      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search recoveries..."
        resultCount={filtered.length}
        totalCount={rows.length}
      />
      <div className="table-shell">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Party</th>
                <th>Amount</th>
                <th>City / Route</th>
                <th>Remarks</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pager.slice.length ? (
                pager.slice.map((r) => {
                  const party = r.parties
                    ? `${r.parties.party_code} — ${r.parties.name_en}`
                    : "—";
                  const fields: DetailField[] = [
                    { label: "Date", value: r.recovery_date },
                    { label: "Party", value: party },
                    { label: "Amount", value: formatPkr(r.amount) },
                    {
                      label: "City / Route",
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
                  <td colSpan={6} className="py-8 text-center text-[var(--muted)]">
                    No recoveries yet.
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
  );
}
