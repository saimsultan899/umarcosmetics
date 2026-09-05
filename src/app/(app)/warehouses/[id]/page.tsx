import { WarehouseForm } from "@/components/forms/warehouse-form";
import { Button } from "@/components/ui/button";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { requireCompanyContext } from "@/lib/auth";
import { formatUomCompact } from "@/lib/pricing/uom";
import { formatNumber, formatPkr } from "@/lib/utils";
import { ArrowLeft, Package } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function WarehouseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, company } = await requireCompanyContext();

  const { data: warehouse } = await supabase
    .from("warehouses")
    .select("*")
    .eq("company_id", company.id)
    .eq("id", id)
    .maybeSingle();

  if (!warehouse) notFound();

  const [{ data: products }, { data: balances }] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, code, name_en, product_type, retail_rate, purchase_rate, packing, unit_type, base_unit, reorder_level, is_active",
      )
      .eq("company_id", company.id)
      .eq("is_active", true)
      .eq("default_warehouse_id", id)
      .order("code"),
    supabase
      .from("stock_balances")
      .select("product_id, qty")
      .eq("warehouse_id", id),
  ]);

  const qtyByProduct = new Map<string, number>();
  for (const row of balances || []) {
    qtyByProduct.set(row.product_id, Number(row.qty || 0));
  }

  const rows = (products || []).map((p) => {
    const qty = qtyByProduct.get(p.id) || 0;
    return { ...p, qty };
  });

  const totalSkus = rows.length;
  const inStock = rows.filter((r) => r.qty > 0).length;
  const stockValue = rows.reduce(
    (sum, r) => sum + r.qty * Number(r.purchase_rate || 0),
    0,
  );

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
                companyId={company.id}
                organizationId={company.organization_id}
                initial={warehouse}
              />
            </CreateDialogButton>
            <Link href={`/products?warehouse=${id}`}>
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
              href={`/products?warehouse=${id}`}
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
