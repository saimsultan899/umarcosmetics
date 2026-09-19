"use client";

import { WarehouseForm } from "@/components/forms/warehouse-form";
import { Button } from "@/components/ui/button";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import {
  useWarehouseDetail,
  type WarehouseProductRow,
} from "@/hooks/use-warehouse-detail";
import { formatUomCompact } from "@/lib/pricing/uom";
import type { Warehouse } from "@/lib/types/database";
import { formatNumber, formatPkr } from "@/lib/utils";
import { ArrowLeft, Package } from "lucide-react";
import Link from "next/link";

export function WarehouseDetailView({
  companyId,
  organizationId,
  warehouseId,
  initialWarehouse,
  initialRows,
  initialOffline = false,
}: {
  companyId: string;
  organizationId: string;
  warehouseId: string;
  initialWarehouse?: Warehouse | null;
  initialRows?: WarehouseProductRow[];
  initialOffline?: boolean;
}) {
  const { warehouse, rows, totalSkus, inStock, stockValue, loading } =
    useWarehouseDetail({
      companyId,
      warehouseId,
      initialWarehouse,
      initialRows,
      initialOffline,
    });

  if (loading) {
    return (
      <div className="animate-rise space-y-6">
        <PageSkeleton />
      </div>
    );
  }

  if (!warehouse) {
    return (
      <div className="animate-rise space-y-6">
        <div className="panel p-8 text-center">
          <h2 className="text-xl font-semibold">Company not found</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Could not find this stock location.
          </p>
          <Link
            href="/warehouses"
            className="mt-4 inline-flex items-center rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white"
          >
            Back to all companies
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title={warehouse.name}
        description={
          [
            warehouse.code || "No code",
            warehouse.address || null,
            "Products assigned to this stock company",
          ]
            .filter(Boolean)
            .join(" · ")
        }
        actions={
          <>
            <Link href="/warehouses">
              <Button variant="secondary" size="sm">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                All companies
              </Button>
            </Link>
            <CreateDialogButton
              label="Edit company"
              title={`Edit ${warehouse.name}`}
              description="Update company name, code, or address"
            >
              <WarehouseForm
                companyId={companyId}
                organizationId={organizationId}
                initial={warehouse}
              />
            </CreateDialogButton>
            <Link href={`/products?warehouse=${warehouseId}`}>
              <Button size="sm">
                <Package className="mr-1.5 h-3.5 w-3.5" />
                Manage products
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="panel p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Products
          </p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold">
            {formatNumber(totalSkus, 0)}
          </p>
        </div>
        <div className="panel p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            In stock
          </p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold">
            {formatNumber(inStock, 0)}
          </p>
        </div>
        <div className="panel p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Stock value
          </p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold">
            {formatPkr(stockValue)}
          </p>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
            Products in {warehouse.name}
          </h2>
          <p className="text-sm text-[var(--muted)]">
            Only items whose Company field is set to this stock company.
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-[var(--muted)]">
            No products assigned yet. Open{" "}
            <Link
              href={`/products?warehouse=${warehouseId}`}
              className="font-medium text-[var(--brand)] underline-offset-2 hover:underline"
            >
              Products
            </Link>{" "}
            and set Company to {warehouse.name}.
          </p>
        ) : (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Pack</th>
                  <th>Sale rate</th>
                  <th>Stock</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium">{p.code}</td>
                    <td>
                      <div>{p.name_en}</div>
                      <div className="text-xs text-[var(--muted)]">
                        {p.product_type || "—"}
                      </div>
                    </td>
                    <td className="text-[var(--muted)]">{warehouse.name}</td>
                    <td>
                      {formatNumber(p.packing, 0)}/
                      {(p.unit_type || "ctn").toLowerCase()}
                    </td>
                    <td>{formatPkr(p.retail_rate)}</td>
                    <td
                      className={
                        p.qty > 0
                          ? "font-medium text-[var(--brand)]"
                          : "text-[var(--muted)]"
                      }
                    >
                      {p.qty > 0
                        ? formatUomCompact(p.qty, p.packing, {
                            unitType: p.unit_type,
                            baseUnit: p.base_unit,
                          })
                        : "0"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
