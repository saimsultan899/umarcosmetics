"use client";

import { DocumentRowActions } from "@/components/tables/document-row-actions";
import { SimplePaginatedTable } from "@/components/tables/simple-paginated-table";

type TransferRow = {
  id: string;
  transfer_no: string;
  transfer_date: string;
  from_name: string;
  to_name: string;
};

export function TransfersTable({ rows }: { rows: TransferRow[] }) {
  const mapped = rows.map((t) => ({
    id: t.id,
    transfer_no: t.transfer_no,
    transfer_date: t.transfer_date,
    from_name: t.from_name,
    to_name: t.to_name,
    _search: `${t.transfer_no} ${t.from_name} ${t.to_name}`,
  }));

  return (
    <SimplePaginatedTable
      columns={["Transfer #", "Date", "From", "To", "Actions"]}
      rows={mapped}
      emptyLabel="No transfers yet."
      renderRow={(row) => (
        <tr key={row.id}>
          <td className="font-medium">{String(row.transfer_no)}</td>
          <td>{String(row.transfer_date)}</td>
          <td>{String(row.from_name)}</td>
          <td>{String(row.to_name)}</td>
          <td>
            <DocumentRowActions
              title={`Transfer ${row.transfer_no}`}
              href={`/warehouses/transfers/${row.id}`}
              table="stock_transfers"
              id={row.id}
              linesTable="stock_transfer_items"
              linesFk="stock_transfer_id"
              fields={[
                { label: "Transfer #", value: String(row.transfer_no) },
                { label: "Date", value: String(row.transfer_date) },
                { label: "From", value: String(row.from_name) },
                { label: "To", value: String(row.to_name) },
              ]}
            />
          </td>
        </tr>
      )}
    />
  );
}
