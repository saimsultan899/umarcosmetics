"use client";

import { PurchaseInvoiceForm } from "@/components/trading/purchase-invoice-form";
import { SaleInvoiceForm } from "@/components/trading/sale-invoice-form";
import { CreateDialogButton } from "@/components/ui/create-dialog";
import {
  CatalogSlot,
  useTradingCatalog,
} from "@/lib/trading/catalog-client";
import type { Company } from "@/lib/types/database";
import { normalizeSaleStockPolicy } from "@/lib/trading/sale-stock-policy";

export function SaleInvoiceCreateButton({ company }: { company: Company }) {
  const catalog = useTradingCatalog(company.id, { stock: true, salesmen: true });
  const canCreate =
    !catalog.ready ||
    Boolean(catalog.error) ||
    (catalog.parties.length > 0 &&
      catalog.products.length > 0 &&
      catalog.warehouses.length > 0);

  return (
    <CreateDialogButton
      label="New sale"
      title="New sale invoice"
      description="Post a sale and deduct company stock"
      size="xl"
      disabled={!canCreate}
      disabledHint="Add at least one customer, product, and company first."
    >
      <CatalogSlot ready={catalog.ready} error={catalog.error}>
        <SaleInvoiceForm
          companyId={company.id}
          organizationId={company.organization_id}
          parties={catalog.parties}
          products={catalog.products}
          warehouses={catalog.warehouses}
          stockBalances={catalog.stockBalances}
          salesmen={catalog.salesmen}
          saleStockPolicy={normalizeSaleStockPolicy(company.sale_stock_policy)}
        />
      </CatalogSlot>
    </CreateDialogButton>
  );
}

export function PurchaseInvoiceCreateButton({ company }: { company: Company }) {
  const catalog = useTradingCatalog(company.id);

  return (
    <CreateDialogButton
      label="New purchase"
      title="New purchase invoice"
      description="Receive vendor stock into a company"
      size="xl"
    >
      <CatalogSlot ready={catalog.ready} error={catalog.error}>
        <PurchaseInvoiceForm
          companyId={company.id}
          organizationId={company.organization_id}
          parties={catalog.parties}
          products={catalog.products}
          warehouses={catalog.warehouses}
        />
      </CatalogSlot>
    </CreateDialogButton>
  );
}
