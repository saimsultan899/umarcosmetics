import { PrintDocument } from "@/components/trading/print-document";
import { requireCompanyContext } from "@/lib/auth";
import { notFound } from "next/navigation";

export default async function StockTransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, company } = await requireCompanyContext();

  const { data: doc } = await supabase
    .from("stock_transfers")
    .select(
      "*, from_warehouse:warehouses!stock_transfers_from_warehouse_id_fkey(name), to_warehouse:warehouses!stock_transfers_to_warehouse_id_fkey(name)",
    )
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();

  if (!doc) notFound();

  const { data: items } = await supabase
    .from("stock_transfer_items")
    .select("*")
    .eq("stock_transfer_id", id)
    .order("sort_order");

  return (
    <PrintDocument
      companyName={company.name}
      companyAddress={[company.address, company.city].filter(Boolean).join(", ")}
      title="Warehouse Transfer Note"
      docNo={doc.transfer_no}
      date={doc.transfer_date}
      warehouseName={`${doc.from_warehouse?.name || "?"} → ${doc.to_warehouse?.name || "?"}`}
      lines={(items || []).map((i) => ({
        product_code: i.product_code,
        product_name: i.product_name,
        qty: Number(i.qty),
      }))}
    />
  );
}
