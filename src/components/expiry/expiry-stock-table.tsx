"use client";

import { TableFilterSelect } from "@/components/tables/table-filter-select";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableScroll } from "@/components/tables/table-scroll";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PrintButton } from "@/components/ui/print-button";
import { RowActions } from "@/components/ui/row-actions";
import type { ExpiryStockRow } from "@/lib/queries/expiry";
import { createClient } from "@/lib/supabase/client";
import { formatNumber, formatPkr } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useSingleSubmit } from "@/lib/forms/single-submit";
import { useClientPagination } from "@/hooks/use-client-pagination";
import type { Warehouse } from "@/lib/types/database";
import { FormEvent, useEffect, useMemo, useState } from "react";

async function setExpiryQty(
  companyId: string,
  productId: string,
  qty: number,
  narration?: string,
) {
  const supabase = createClient();
  const { error } = await supabase.rpc("set_expiry_stock_qty", {
    p_company_id: companyId,
    p_product_id: productId,
    p_qty: qty,
    p_narration: narration || null,
  });
  if (error) throw new Error(error.message);
}

function ExpiryQtyForm({
  companyId,
  row,
  onDone,
}: {
  companyId: string;
  row: ExpiryStockRow;
  onDone: () => void;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(String(row.qty));
  const [narration, setNarration] = useState("");
  const [loading, setLoading] = useState(false);
  const singleSubmit = useSingleSubmit();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await singleSubmit(async () => {
    const next = Number(qty);
    if (!Number.isFinite(next) || next < 0) {
      setError("Enter a quantity of 0 or more.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await setExpiryQty(companyId, row.product_id, next, narration.trim());
      onDone();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setLoading(false);
    }
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <p className="text-sm text-[var(--muted)]">
        {row.product_code} — {row.product_name}. This changes expiry warehouse
        qty only (not saleable stock). Set 0 to clear the line.
      </p>
      <div>
        <Label htmlFor="expiry-qty">Qty</Label>
        <Input
          id="expiry-qty"
          type="number"
          min={0}
          step="1"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          required
        />
      </div>
      <div>
        <Label htmlFor="expiry-narration">Note (optional)</Label>
        <Input
          id="expiry-narration"
          value={narration}
          onChange={(e) => setNarration(e.target.value)}
          placeholder="Count correction, write-off…"
        />
      </div>
      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={loading}>
          {loading ? "Saving..." : "Save qty"}
        </Button>
      </div>
    </form>
  );
}

export function ExpiryStockTable({
  companyId,
  companyName,
  rows,
  warehouses = [],
}: {
  companyId: string;
  companyName: string;
  rows: ExpiryStockRow[];
  warehouses?: Array<Pick<Warehouse, "id" | "name">>;
}) {
  const [printedAt, setPrintedAt] = useState("");
  const [query, setQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");

  const companyLabel = useMemo(() => {
    const names = new Map(warehouses.map((w) => [w.id, w.name]));
    return (id: string | null) => (id ? names.get(id) || "—" : "—");
  }, [warehouses]);

  const companyOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const row of rows) {
      if (!row.warehouse_id) continue;
      names.set(row.warehouse_id, companyLabel(row.warehouse_id));
    }
    return [...names.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, companyLabel]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (companyFilter && row.warehouse_id !== companyFilter) return false;
      if (!q) return true;
      const company = companyLabel(row.warehouse_id).toLowerCase();
      return [row.product_code, row.product_name, company].join(" ").toLowerCase().includes(q);
    });
  }, [rows, query, companyFilter, companyLabel]);

  const pager = useClientPagination(filtered);
  const totalQty = filtered.reduce((s, r) => s + r.qty, 0);
  const totalValue = filtered.reduce((s, r) => s + r.amount, 0);

  useEffect(() => {
    setPrintedAt(new Date().toLocaleString());
  }, []);

  return (
    <div className="space-y-3">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          On-hand
        </h2>
        <PrintButton label="Print list" printId="expiry-on-hand" />
      </div>

      <div className="no-print">
        <TableToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="Search code or item..."
          resultCount={filtered.length}
          totalCount={rows.length}
          filters={
            <TableFilterSelect
              label="Company"
              value={companyFilter}
              allLabel="All companies"
              options={companyOptions}
              onChange={(value) => setCompanyFilter(value || "")}
            />
          }
        />
      </div>

      <div className="table-shell table-shell--y-scroll no-print">
        <TableScroll>
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Item</th>
                <th>Company</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Rate</th>
                <th className="text-right">Value</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pager.slice.length ? (
                pager.slice.map((row) => (
                  <tr key={row.product_id}>
                    <td className="tabular-nums">{row.product_code}</td>
                    <td>{row.product_name}</td>
                    <td>{companyLabel(row.warehouse_id)}</td>
                    <td className="text-right tabular-nums">
                      {formatNumber(row.qty, 2)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatNumber(row.rate, 2)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatPkr(row.amount)}
                    </td>
                    <td>
                      <RowActions
                        viewTitle={`${row.product_code} — ${row.product_name}`}
                        viewFields={[
                          { label: "Code", value: row.product_code },
                          { label: "Item", value: row.product_name },
                          { label: "Company", value: companyLabel(row.warehouse_id) },
                          { label: "Qty", value: formatNumber(row.qty, 2) },
                          { label: "Rate", value: formatPkr(row.rate) },
                          { label: "Value", value: formatPkr(row.amount) },
                        ]}
                        printHref={`/inventory/expiry/stock/${row.product_id}`}
                        editTitle="Update expiry qty"
                        editContent={(close) => (
                          <ExpiryQtyForm
                            companyId={companyId}
                            row={row}
                            onDone={close}
                          />
                        )}
                        deleteTitle={`Clear ${row.product_code}?`}
                        deleteDescription="This sets expiry warehouse qty to 0. Saleable stock is not changed. Customer credits already posted stay on the ledger."
                        onDelete={() =>
                          setExpiryQty(
                            companyId,
                            row.product_id,
                            0,
                            "Cleared from expiry on-hand",
                          )
                        }
                      />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={7}
                    className="py-10 text-center text-[var(--muted)]"
                  >
                    {rows.length
                      ? "No products match this search or company."
                      : "No expired stock on hand."}
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

      <div data-print-id="expiry-on-hand" className="print-only print-sheet report-print">
        <div className="report-print-head">
          <div>
            <p className="report-print-title">Expiry warehouse — on-hand</p>
            <p className="report-print-co">{companyName}</p>
          </div>
          <p className="report-print-meta">
            {filtered.length} items
            {companyFilter ? ` · ${companyLabel(companyFilter)}` : ""}
            {printedAt ? ` · Printed ${printedAt}` : ""}
          </p>
        </div>
        {filtered.length ? (
          <table>
            <thead>
              <tr>
                <th className="num" style={{ width: "10mm" }}>
                  #
                </th>
                <th>Code</th>
                <th>Item</th>
                <th>Company</th>
                <th className="num">Qty</th>
                <th className="num">Rate</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => (
                <tr key={row.product_id}>
                  <td className="num">{idx + 1}</td>
                  <td>{row.product_code}</td>
                  <td>{row.product_name}</td>
                  <td>{companyLabel(row.warehouse_id)}</td>
                  <td className="num">{formatNumber(row.qty, 2)}</td>
                  <td className="num">{formatPkr(row.rate)}</td>
                  <td className="num">{formatPkr(row.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td />
                <td />
                <td>Total</td>
                <td className="num">{formatNumber(totalQty, 2)}</td>
                <td />
                <td className="num">{formatPkr(totalValue)}</td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <p>No expired stock on hand.</p>
        )}
      </div>
    </div>
  );
}
