import { ExpiryStockItemView } from "@/components/expiry/expiry-stock-item-view";
import { requireCompanyContext } from "@/lib/auth";
import { fetchExpiryStock, type ExpiryStockRow } from "@/lib/queries/expiry";

export default async function ExpiryStockPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { productId } = await params;
  const sp = await searchParams;
  const autoPrint = sp.print === "1" || sp.print === "true";
  const { supabase, company, offline } = await requireCompanyContext();

  let initialRow: ExpiryStockRow | null = null;

  if (!offline) {
    try {
      const stock = await fetchExpiryStock(supabase, company.id);
      initialRow = stock.find((r) => r.product_id === productId) || null;
    } catch {
      initialRow = null;
    }
  }

  return (
    <ExpiryStockItemView
      company={company}
      productId={productId}
      initialRow={initialRow}
      initialOffline={offline}
      autoPrint={autoPrint}
    />
  );
}
