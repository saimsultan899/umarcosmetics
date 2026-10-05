import { ExpiryWarehouseView } from "@/components/expiry/expiry-warehouse-view";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { requireCompanyContext } from "@/lib/auth";
import type { Warehouse } from "@/lib/types/database";
import {
  documentListConfigs,
  fetchDocumentList,
} from "@/lib/queries/documents";
import { fetchExpiryStock } from "@/lib/queries/expiry";
import type { ExpiryWarehouseData } from "@/hooks/use-expiry-warehouse";
import { Suspense } from "react";

export default async function ExpiryWarehousePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { company, supabase, offline } = await requireCompanyContext();

  let initialData: ExpiryWarehouseData | null = null;
  let warehouses: Warehouse[] = [];

  if (!offline) {
    try {
      const monthStart = new Date();
      monthStart.setDate(1);
      const monthFrom = monthStart.toISOString().slice(0, 10);

      const [stock, receipts, claims, monthReceipts, openClaims, warehouseRes] =
        await Promise.all([
          fetchExpiryStock(supabase, company.id),
          fetchDocumentList(
            supabase,
            company.id,
            sp,
            documentListConfigs.expiryReceipt,
          ),
          fetchDocumentList(
            supabase,
            company.id,
            sp,
            documentListConfigs.expiryClaim,
          ),
          supabase
            .from("expiry_receipts")
            .select("grand_total")
            .eq("company_id", company.id)
            .gte("receipt_date", monthFrom),
          supabase
            .from("expiry_claims")
            .select("id", { count: "exact", head: true })
            .eq("company_id", company.id)
            .eq("claim_status", "open"),
          supabase
            .from("warehouses")
            .select("*")
            .eq("company_id", company.id)
            .eq("is_active", true)
            .order("name"),
        ]);
      warehouses = (warehouseRes.data || []) as Warehouse[];

      const onHandQty = stock.reduce((s, r) => s + r.qty, 0);
      const onHandValue = stock.reduce((s, r) => s + r.amount, 0);
      const monthCredit = (monthReceipts.data || []).reduce(
        (s, r) => s + Number(r.grand_total || 0),
        0,
      );

      initialData = {
        stock,
        receipts,
        claims,
        stats: {
          productsOnHand: stock.length,
          onHandQty,
          onHandValue,
          openClaimsCount: openClaims.count || 0,
          monthCredit,
        },
      };
    } catch (err) {
      console.error("Failed to load initial expiry warehouse data:", err);
      initialData = null;
    }
  }

  return (
    <Suspense fallback={<PageSkeleton />}>
      <ExpiryWarehouseView
        company={company}
        initialData={initialData}
        initialWarehouses={warehouses}
        initialOffline={offline}
      />
    </Suspense>
  );
}
