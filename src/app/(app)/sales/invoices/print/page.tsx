import { SaleInvoicesBatchPrint } from "@/components/trading/sale-invoices-batch-print";
import { requireCompanyContext } from "@/lib/auth";
import {
  loadSaleInvoicePrintData,
  parseSelectedInvoiceIds,
} from "@/lib/trading/load-sale-invoice-print";
import Link from "next/link";

export default async function SaleInvoicesBatchPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const ids = parseSelectedInvoiceIds(sp.ids);
  const autoPrint = sp.print !== "0" && sp.print !== "false";
  const { supabase, company, profile, offline } = await requireCompanyContext();

  if (!ids.length) {
    return (
      <div className="animate-rise space-y-3 rounded-xl border border-[var(--border)] bg-white p-6">
        <h1 className="text-lg font-semibold">No invoices selected</h1>
        <p className="text-sm text-[var(--muted)]">
          Go back to Sale Invoice, tick the checkboxes, then click Print selected.
        </p>
        <Link
          href="/sales/invoices"
          className="inline-flex h-9 items-center rounded-lg bg-[var(--brand)] px-3 text-sm font-medium text-white"
        >
          Back to sale invoices
        </Link>
      </div>
    );
  }

  if (offline) {
    return (
      <div className="animate-rise space-y-3 rounded-xl border border-amber-200 bg-amber-50/70 p-6">
        <h1 className="text-lg font-semibold text-amber-950">
          Print selected needs online
        </h1>
        <p className="text-sm text-amber-900/90">
          Connect to the internet, then print the selected invoices again.
        </p>
        <Link
          href="/sales/invoices"
          className="inline-flex h-9 items-center rounded-lg bg-[var(--brand)] px-3 text-sm font-medium text-white"
        >
          Back to sale invoices
        </Link>
      </div>
    );
  }

  const loaded = await Promise.all(
    ids.map((id) =>
      loadSaleInvoicePrintData(supabase, {
        companyId: company.id,
        companyName: company.name,
        companyPhone: company.phone,
        invoiceId: id,
        preparedByFallback: profile?.full_name,
      }),
    ),
  );
  const invoices = loaded.filter(
    (row): row is NonNullable<(typeof loaded)[number]> => Boolean(row),
  );

  if (!invoices.length) {
    return (
      <div className="animate-rise space-y-3 rounded-xl border border-[var(--border)] bg-white p-6">
        <h1 className="text-lg font-semibold">Invoices not found</h1>
        <p className="text-sm text-[var(--muted)]">
          None of the selected invoices are available for this company.
        </p>
        <Link
          href="/sales/invoices"
          className="inline-flex h-9 items-center rounded-lg bg-[var(--brand)] px-3 text-sm font-medium text-white"
        >
          Back to sale invoices
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-rise">
      <SaleInvoicesBatchPrint invoices={invoices} autoPrint={autoPrint} />
    </div>
  );
}
