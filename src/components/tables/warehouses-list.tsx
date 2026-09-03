"use client";

import { WarehouseForm } from "@/components/forms/warehouse-form";
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { formatNumber, formatPkr } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { Warehouse } from "@/lib/types/database";
import Link from "next/link";

export type WarehouseListStats = {
  warehouseId: string;
  productCount: number;
  inStockCount: number;
  stockValue: number;
};

function warehouseFields(
  w: Warehouse,
  stats?: WarehouseListStats,
): DetailField[] {
  return [
    { label: "Name", value: w.name },
    { label: "Code", value: w.code || "—" },
    { label: "Address", value: w.address || "—" },
    {
      label: "Products",
      value: formatNumber(stats?.productCount ?? 0, 0),
    },
    {
      label: "In stock SKUs",
      value: formatNumber(stats?.inStockCount ?? 0, 0),
    },
    {
      label: "Stock value",
      value: formatPkr(stats?.stockValue ?? 0),
    },
  ];
}

export function WarehousesList({
  warehouses,
  companyId,
  organizationId,
  statsByWarehouse = {},
}: {
  warehouses: Warehouse[];
  companyId: string;
  organizationId: string;
  statsByWarehouse?: Record<string, WarehouseListStats>;
}) {
  async function deactivate(id: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("warehouses")
      .update({ is_active: false })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }

  if (!warehouses.length) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]">
        No companies yet.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {warehouses.map((w) => {
        const stats = statsByWarehouse[w.id];
        const productCount = stats?.productCount ?? 0;
        const inStockCount = stats?.inStockCount ?? 0;

        return (
          <div key={w.id} className="panel flex flex-col p-4">
            <Link
              href={`/warehouses/${w.id}`}
              className="group min-w-0 flex-1 outline-none"
            >
              <p className="font-[family-name:var(--font-display)] text-lg font-semibold transition group-hover:text-[var(--brand)]">
                {w.name}
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                {w.code || "No code"}
              </p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {w.address || "No address"}
              </p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span>
                  <span className="font-medium tabular-nums">
                    {formatNumber(productCount, 0)}
                  </span>{" "}
                  <span className="text-[var(--muted)]">products</span>
                </span>
                <span>
                  <span className="font-medium tabular-nums">
                    {formatNumber(inStockCount, 0)}
                  </span>{" "}
                  <span className="text-[var(--muted)]">in stock</span>
                </span>
              </div>
            </Link>
            <div className="mt-3 flex items-center justify-end gap-2">
              <RowActions
                href={`/warehouses/${w.id}`}
                viewTitle={w.name}
                editTitle={`Edit ${w.name}`}
                deleteTitle={`Remove ${w.name}?`}
                deleteDescription="This company will be removed from this list. It can be restored later if needed."
                viewFields={warehouseFields(w, stats)}
                onDelete={() => deactivate(w.id)}
                editContent={(close) => (
                  <WarehouseForm
                    companyId={companyId}
                    organizationId={organizationId}
                    initial={w}
                    onDone={close}
                  />
                )}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
