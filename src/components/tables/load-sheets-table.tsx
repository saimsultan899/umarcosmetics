"use client";

import { SimplePaginatedTable } from "@/components/tables/simple-paginated-table";
import Link from "next/link";

type Row = {
  id: string;
  sheet_no: string;
  sheet_date: string;
  warehouse: string;
  vehicle_route: string;
  qty: string;
  status: string;
};

export function LoadSheetsTable({ rows }: { rows: Row[] }) {
  const mapped = rows.map((r) => ({
    ...r,
    _search: `${r.sheet_no} ${r.warehouse} ${r.vehicle_route} ${r.status}`,
  }));

  return (
    <SimplePaginatedTable
      columns={["Sheet #", "Date", "Warehouse", "Vehicle / Sector", "Lines qty", "Status"]}
      rows={mapped}
      emptyLabel="No load sheets yet. Issue your first van load above."
      renderRow={(row) => (
        <tr key={row.id}>
          <td>
            <Link
              href={`/inventory/load-sheets/${row.id}`}
              className="font-medium text-[var(--brand)] hover:underline"
            >
              {String(row.sheet_no)}
            </Link>
          </td>
          <td>{String(row.sheet_date)}</td>
          <td>{String(row.warehouse)}</td>
          <td className="text-[var(--muted)]">{String(row.vehicle_route)}</td>
          <td>{String(row.qty)}</td>
          <td>
            <span className="rounded-full bg-[var(--surface-2)] px-2 py-1 text-xs font-semibold uppercase">
              {String(row.status)}
            </span>
          </td>
        </tr>
      )}
    />
  );
}
