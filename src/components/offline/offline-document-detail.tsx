"use client";

import { OfflineBanner } from "@/components/offline/offline-banner";
import { PageHeading } from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import {
  PrintDocument,
  type PrintLine,
  type PrintMeta,
} from "@/components/trading/print-document";
import {
  SaleInvoicePrint,
  type SalePrintLine,
} from "@/components/trading/sale-invoice-print";
import { offlineCachedDocument } from "@/lib/offline/offline-reports";
import type { CacheStoreName } from "@/lib/offline/local-db";
import {
  hasLocalSqlite,
  localGetDocument,
  localGetLocalDocument,
  type LocalDocumentTable,
} from "@/lib/offline/sqlite-client";
import { formatPkr } from "@/lib/utils";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type DocKind =
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
  | "expiry_claim";

const STORE_BY_KIND: Record<DocKind, CacheStoreName> = {
  sale_invoice: "sale_invoices",
  purchase_invoice: "purchase_invoices",
  sale_return: "sale_returns",
  purchase_return: "purchase_returns",
  gate_pass: "gate_passes",
  load_sheet: "load_sheets",
  stock_transfer: "stock_transfers",
  voucher: "vouchers",
  expense: "expenses",
  expiry_receipt: "expiry_receipts",
  expiry_claim: "expiry_claims",
};

const TITLE_BY_KIND: Record<DocKind, string> = {
  sale_invoice: "Sale invoice",
  purchase_invoice: "Purchase invoice",
  sale_return: "Sale return",
  purchase_return: "Purchase return",
  gate_pass: "Gate pass",
  load_sheet: "Load sheet",
  stock_transfer: "Stock transfer",
  voucher: "Voucher",
  expense: "Expense",
  expiry_receipt: "Expiry receipt",
  expiry_claim: "Expiry claim",
};

import { formatReportInvNo } from "@/lib/reports/helpers";
import {
  migrateLegacyLocalDocNos,
} from "@/lib/offline/offline-submit";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function pickItems(doc: Record<string, unknown>): PrintLine[] {
  const payload = asRecord(doc.payload) || doc;
  const raw =
    (Array.isArray(payload.items) && payload.items) ||
    (Array.isArray(payload.lines) && payload.lines) ||
    (Array.isArray(payload.sale_invoice_items) && payload.sale_invoice_items) ||
    (Array.isArray(payload.purchase_invoice_items) && payload.purchase_invoice_items) ||
    (Array.isArray(payload.sale_return_items) && payload.sale_return_items) ||
    (Array.isArray(payload.purchase_return_items) && payload.purchase_return_items) ||
    (Array.isArray(payload.stock_transfer_items) && payload.stock_transfer_items) ||
    (Array.isArray(payload.gate_pass_items) && payload.gate_pass_items) ||
    (Array.isArray(payload.load_sheet_items) && payload.load_sheet_items) ||
    (Array.isArray(payload.voucher_lines) && payload.voucher_lines) ||
    (Array.isArray(payload.expiry_receipt_items) && payload.expiry_receipt_items) ||
    (Array.isArray(payload.expiry_claim_items) && payload.expiry_claim_items) ||
    (Array.isArray(doc.lines) && doc.lines) ||
    (Array.isArray(doc.items) && doc.items) ||
    (Array.isArray(doc.sale_invoice_items) && doc.sale_invoice_items) ||
    (Array.isArray(doc.purchase_invoice_items) && doc.purchase_invoice_items) ||
    (Array.isArray(doc.sale_return_items) && doc.sale_return_items) ||
    (Array.isArray(doc.purchase_return_items) && doc.purchase_return_items) ||
    (Array.isArray(doc.stock_transfer_items) && doc.stock_transfer_items) ||
    (Array.isArray(doc.gate_pass_items) && doc.gate_pass_items) ||
    (Array.isArray(doc.load_sheet_items) && doc.load_sheet_items) ||
    (Array.isArray(doc.voucher_lines) && doc.voucher_lines) ||
    (Array.isArray(doc.expiry_receipt_items) && doc.expiry_receipt_items) ||
    (Array.isArray(doc.expiry_claim_items) && doc.expiry_claim_items) ||
    [];

  return (raw as Record<string, unknown>[]).map((item) => ({
    product_code: String(item.product_code || ""),
    product_name: String(item.product_name || item.category || item.remarks || "Line"),
    qty: Number(item.qty || item.send_qty || 1),
    bonus: Number(item.bonus_qty || item.bonus || 0) || undefined,
    rate: Number(item.rate || item.unit_price || 0) || undefined,
    discount: Number(item.discount || 0) || undefined,
    amount: Number(item.amount || 0) || undefined,
  }));
}

async function loadLocalDoc(
  kind: DocKind,
  companyId: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  if (hasLocalSqlite()) {
    if (kind === "sale_invoice" || kind === "purchase_invoice") {
      const table: LocalDocumentTable =
        kind === "sale_invoice" ? "sale_invoices" : "purchase_invoices";
      const res = await localGetDocument(table, id);
      if (res.ok && res.row) return res.row;
    } else {
      const res = await localGetLocalDocument(id);
      if (res.ok && res.row) {
        const payload = asRecord(res.row.payload) || {};
        return { ...payload, ...res.row };
      }
    }
  }

  return offlineCachedDocument(STORE_BY_KIND[kind], companyId, id);
}

export function OfflineDocumentDetail({
  kind,
  companyId,
  companyName,
  documentId,
  listHref,
  autoPrint,
}: {
  kind: DocKind;
  companyId: string;
  companyName?: string;
  documentId: string;
  listHref: string;
  autoPrint?: boolean;
}) {
  const [doc, setDoc] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      if (hasLocalSqlite()) {
        try {
          const { localMigrateLegacyDocNos } = await import("@/lib/offline/sqlite-client");
          await localMigrateLegacyDocNos(companyId);
        } catch {}
      }
      try {
        await migrateLegacyLocalDocNos(companyId);
      } catch {}
      const row = await loadLocalDoc(kind, companyId, documentId);
      if (!cancelled) {
        setDoc(row);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, companyId, documentId]);

  const lines = useMemo(() => (doc ? pickItems(doc) : []), [doc]);

  const saleInvoiceLines: SalePrintLine[] = useMemo(() => {
    if (!doc) return [];
    const payload = asRecord(doc.payload) || doc;
    const raw =
      (Array.isArray(payload.items) && payload.items) ||
      (Array.isArray(payload.lines) && payload.lines) ||
      (Array.isArray(payload.sale_invoice_items) && payload.sale_invoice_items) ||
      (Array.isArray(doc.lines) && doc.lines) ||
      (Array.isArray(doc.items) && doc.items) ||
      (Array.isArray(doc.sale_invoice_items) && doc.sale_invoice_items) ||
      [];
    return (raw as Record<string, unknown>[]).map((item) => {
      const qty = Number(item.qty || 0);
      const tradePrice = Number(item.rate || item.purchase_rate || item.retail_rate || 0);
      const discount = Number(item.discount || 0);
      const amount =
        Number(item.amount) ||
        (qty > 0 && tradePrice > 0 ? qty * tradePrice - discount : 0);
      return {
        product_code: (item.product_code as string) || null,
        product_name: String(item.product_name || "Line"),
        qty,
        bonus: Number(item.bonus_qty || item.bonus || 0) || undefined,
        scheme: (item.scheme as string) || null,
        tradePrice,
        discount,
        amount,
      };
    });
  }, [doc]);

  const view = useMemo(() => {
    if (!doc) return null;
    const payload = asRecord(doc.payload) || doc;
    const rawDocNo = String(
      doc.invoice_no ||
        doc.doc_no ||
        doc.pass_no ||
        doc.voucher_no ||
        doc._localId ||
        documentId,
    );
    const docNo = formatReportInvNo(rawDocNo) || rawDocNo;
    const date = String(
      doc.invoice_date ||
        doc.return_date ||
        doc.pass_date ||
        doc.sheet_date ||
        doc.transfer_date ||
        doc.voucher_date ||
        doc.expense_date ||
        doc.receipt_date ||
        doc.claim_date ||
        doc.doc_date ||
        "",
    );
    const partiesObj = asRecord(doc.parties) || asRecord(payload.parties) || {};
    const partyName = String(
      partiesObj.name_en ||
        payload.party_name ||
        doc.party_name ||
        "",
    );
    const partyCode = String(
      partiesObj.party_code ||
        payload.party_code ||
        doc.party_code ||
        "",
    );
    const partyOwner = String(
      partiesObj.contact_person ||
        payload.contact_person ||
        "",
    );
    const partyPhone = String(
      partiesObj.phone ||
        payload.phone ||
        "",
    );
    const partyMobile = String(
      partiesObj.mobile ||
        payload.mobile ||
        "",
    );
    const sector = String(
      partiesObj.route ||
        partiesObj.city ||
        payload.route ||
        payload.city ||
        doc.route ||
        doc.city ||
        "",
    );

    const subtotal = Number(doc.subtotal ?? payload.subtotal ?? 0);
    const tradeDiscount = Number(doc.discount_total ?? payload.discount_total ?? 0);
    const extraDiscount = Number(doc.extra_discount ?? payload.extra_discount ?? 0);
    const total = Number(
      doc.grand_total ?? payload.grand_total ?? doc.amount ?? 0,
    );
    const paid = Number(doc.amount_paid ?? payload.amount_paid ?? 0);
    const paymentType = String(doc.payment_type ?? payload.payment_type ?? "credit");

    const totals: PrintMeta[] = total
      ? [{ label: "Amount", value: formatPkr(total), strong: true }]
      : [];
    return {
      docNo,
      date,
      partyName,
      partyCode,
      partyOwner,
      partyPhone,
      partyMobile,
      sector,
      subtotal,
      tradeDiscount,
      extraDiscount,
      total,
      paid,
      paymentType,
      totals,
    };
  }, [doc, documentId]);

  if (loading) {
    return (
      <div className="animate-rise space-y-4">
        <PageSkeleton />
      </div>
    );
  }

  if (!doc || !view) {
    return (
      <div className="animate-rise space-y-4">
        <PageHeading
          title={`${TITLE_BY_KIND[kind]} not found`}
          description="This document could not be located in records."
        />
        <Link
          href={listHref}
          className="text-sm font-semibold text-[var(--brand)] hover:underline"
        >
          Back to list
        </Link>
      </div>
    );
  }

  // Exact same sale invoice print layout as online
  if (kind === "sale_invoice") {
    return (
      <div className="animate-rise">
        <SaleInvoicePrint
          companyName={companyName || "Company"}
          companyPhone={(doc.company_phone as string) || null}
          docNo={view.docNo}
          date={view.date}
          printedAt={(doc.created_at as string) || null}
          partyCode={view.partyCode || null}
          partyName={view.partyName || null}
          partyOwner={view.partyOwner || null}
          partyPhone={view.partyPhone || null}
          partyMobile={view.partyMobile || null}
          sector={view.sector || null}
          salesmanLabel={(doc.salesman_name as string) || (doc.salesman as any)?.full_name || null}
          lines={saleInvoiceLines}
          subtotal={view.subtotal || view.total}
          tradeDiscount={view.tradeDiscount}
          extraDiscount={view.extraDiscount}
          billAmount={view.total}
          paid={view.paid}
          paymentType={view.paymentType}
          previousPayment={0}
          previousBalance={0}
          creditDays={21}
          autoPrint={autoPrint}
        />
      </div>
    );
  }

  return (
    <div className="animate-rise space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading
          title={TITLE_BY_KIND[kind]}
          description={companyName || "Company"}
        />
        <Link
          href={listHref}
          className="text-sm font-semibold text-[var(--brand)] hover:underline"
        >
          Back to list
        </Link>
      </div>
      <PrintDocument
        title={TITLE_BY_KIND[kind]}
        companyName={companyName || "Company"}
        docNo={view.docNo}
        date={view.date}
        partyName={view.partyName || null}
        lines={lines}
        totals={view.totals}
        autoPrint={autoPrint}
      />
    </div>
  );
}
