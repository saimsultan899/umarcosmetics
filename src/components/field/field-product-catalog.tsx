"use client";

import { TableFilterSelect } from "@/components/tables/table-filter-select";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableScroll } from "@/components/tables/table-scroll";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { useClientPagination } from "@/hooks/use-client-pagination";
import { formatPkr } from "@/lib/utils";
import { useMemo, useState } from "react";

export type CatalogProduct = {
  id: string;
  code: string | null;
  name: string;
  company: string;
  warehouseId: string | null;
  tradePrice: number;
  onHand: number;
};

export function FieldProductCatalog({
  products,
  companies,
}: {
  products: CatalogProduct[];
  companies: string[];
}) {
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState("");
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((row) => {
      if (company && row.company !== company) return false;
      if (!q) return true;
      return `${row.code || ""} ${row.name}`.toLowerCase().includes(q);
    });
  }, [products, query, company]);
  const page = useClientPagination(visible);

  return (
    <div>
      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search product or code"
        resultCount={page.total}
        totalCount={products.length}
        filters={
          <TableFilterSelect
            label="Company"
            value={company}
            allLabel="All companies"
            options={companies.map((name) => ({ value: name, label: name }))}
            onChange={(value) => setCompany(value || "")}
          />
        }
      />
      <div className="table-shell">
        <TableScroll loading={page.isPending}>
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Product</th>
                <th>Company</th>
                <th className="text-right">On hand</th>
                <th className="text-right">Trade price</th>
              </tr>
            </thead>
            <tbody>
              {page.slice.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[var(--muted)]">
                    No products match.
                  </td>
                </tr>
              ) : (
                page.slice.map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium">{row.code || "—"}</td>
                    <td>{row.name}</td>
                    <td>{row.company}</td>
                    <td className="text-right">{row.onHand}</td>
                    <td className="text-right font-semibold">{formatPkr(row.tradePrice)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableScroll>
        <TablePagination
          page={page.page}
          totalPages={page.totalPages}
          pageSize={page.pageSize}
          total={page.total}
          from={page.from}
          to={page.to}
          loading={page.isPending}
          onPageChange={page.setPage}
          onPageSizeChange={page.setPageSize}
        />
      </div>
    </div>
  );
}
