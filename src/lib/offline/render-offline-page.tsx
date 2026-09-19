import { OfflineModulePage, type OfflineModuleKind } from "@/components/offline/offline-module-page";
import { OfflineTradingListPage } from "@/components/offline/offline-trading-list";
import { OnlineOnly } from "@/components/offline/online-only";
import { OfflineDocumentDetail } from "@/components/offline/offline-document-detail";
import type { Company } from "@/lib/types/database";

/** Shared offline page renderer for list modules. */
export function renderOfflineModule(
  kind: OfflineModuleKind,
  company: Company,
) {
  return (
    <OfflineModulePage
      kind={kind}
      companyId={company.id}
      organizationId={company.organization_id}
      companyName={company.name}
    />
  );
}

export function renderOfflineTrading(
  kind: "sale" | "purchase",
  company: Company,
) {
  return (
    <OfflineTradingListPage
      kind={kind}
      companyId={company.id}
      organizationId={company.organization_id}
    />
  );
}

export function renderOnlineOnlyModule(title: string, description: string) {
  return <OnlineOnly title={title} description={description} />;
}

export function renderOfflineDocument(
  kind:
    | "sale_invoice"
    | "purchase_invoice"
    | "sale_return"
    | "purchase_return"
    | "gate_pass"
    | "load_sheet"
    | "stock_transfer"
    | "voucher"
    | "expense"
    | "expiry_receipt"
    | "expiry_claim",
  company: Company,
  documentId: string,
  listHref: string,
  autoPrint?: boolean,
) {
  return (
    <OfflineDocumentDetail
      kind={kind}
      companyId={company.id}
      companyName={company.name}
      documentId={documentId}
      listHref={listHref}
      autoPrint={autoPrint}
    />
  );
}
