import { ProductForm } from "@/components/forms/product-form";
import { ProductsTable } from "@/components/tables/products-table";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { requireCompanyContext } from "@/lib/auth";
import type { Product, Warehouse } from "@/lib/types/database";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const sp = await searchParams;
  const { supabase, company } = await requireCompanyContext();

  const [{ data: products }, { data: warehouses }, { data: balances }] =
    await Promise.all([
      supabase
        .from("products")
        .select("*")
        .eq("company_id", company.id)
        .order("code", { ascending: true })
        .limit(2000),
      supabase
        .from("warehouses")
        .select("*")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("stock_balances")
        .select("qty, products(code, name_en, sale_rate, reorder_level)")
        .eq("company_id", company.id)
        .limit(4000),
    ]);

  const list = (products as Product[] | null) || [];
  const stockValueByCode: Record<string, number> = {};
  const lowStockCodes: string[] = [];

  for (const row of balances || []) {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    if (!product?.code) continue;
    const qty = Number(row.qty || 0);
    const rate = Number(product.sale_rate || 0);
    stockValueByCode[product.code] =
      (stockValueByCode[product.code] || 0) + qty * rate;
    if (
      Number(product.reorder_level) > 0 &&
      qty <= Number(product.reorder_level) &&
      !lowStockCodes.includes(product.code)
    ) {
      lowStockCodes.push(product.code);
    }
  }

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Products"
        description="Inventory masters with rates, packing, and reorder levels. Stats follow table filters."
        actions={
          <CreateDialogButton
            label="Add product"
            title="Add product"
            description="Create a catalog item with rates and packing"
            size="xl"
          >
              <ProductForm
                companyId={company.id}
                organizationId={company.organization_id}
                warehouses={(warehouses as Warehouse[]) || []}
              />
          </CreateDialogButton>
        }
      />

      <ProductsTable
        products={list}
        warehouses={(warehouses as Warehouse[]) || []}
        companyId={company.id}
        organizationId={company.organization_id}
        stockValueByCode={stockValueByCode}
        lowStockCodes={lowStockCodes}
        initialView={sp.view}
      />
    </div>
  );
}
