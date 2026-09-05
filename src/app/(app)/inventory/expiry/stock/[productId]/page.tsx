import { PrintDocument } from "@/components/trading/print-document";
import { requireCompanyContext } from "@/lib/auth";
import { fetchExpiryStock } from "@/lib/queries/expiry";
import { formatPkr } from "@/lib/utils";
import { notFound } from "next/navigation";

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
  const { supabase, company } = await requireCompanyContext();

  const stock = await fetchExpiryStock(supabase, company.id);
  const row = stock.find((r) => r.product_id === productId);
  if (!row) notFound();

  const today = new Date().toISOString().slice(0, 10);

  return (
    <PrintDocument
      companyName={company.name}
      companyAddress={[company.address, company.city].filter(Boolean).join(", ")}
      title="Expiry Warehouse — On-hand"
      docNo={row.product_code}
      date={today}
      printedAt={new Date().toISOString()}
      extraMeta={[{ label: "Item", value: row.product_name }]}
      lines={[
        {
          product_code: row.product_code,
          product_name: row.product_name,
          qty: row.qty,
          rate: row.rate,
          amount: row.amount,
        },
      ]}
      totals={[{ label: "Value", value: formatPkr(row.amount), strong: true }]}
      autoPrint={autoPrint}
    />
  );
}
