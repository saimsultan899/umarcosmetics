import { FieldHeader } from "@/components/field/field-frame";
import { effectivePermissions } from "@/lib/access/permissions";
import { requireCompanyContext } from "@/lib/auth";
import { formatPkr } from "@/lib/utils";
import { BarChart3, Package, Wallet, BookOpen } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

const links = [
  {
    href: "/reports/sales",
    label: "Sales",
    hint: "Posted sale bills, cash and credit",
    icon: BarChart3,
  },
  {
    href: "/reports/recovery",
    label: "Recovery",
    hint: "What customers still owe and what was collected",
    icon: Wallet,
  },
  {
    href: "/reports/salesman-ledger",
    label: "My ledger",
    hint: "Sales, recoveries, salary, and expenses",
    icon: BookOpen,
  },
  {
    href: "/reports/stock",
    label: "Stock",
    hint: "On-hand quantity by company",
    icon: Package,
  },
];

export default async function FieldReportsPage() {
  const { supabase, company, user, membership, offline } = await requireCompanyContext();
  const permissions = effectivePermissions(membership);
  if (membership?.role === "salesman" && !permissions.includes("view_reports")) {
    redirect("/field");
  }
  const monthStart = new Date();
  monthStart.setDate(1);
  const from = monthStart.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  let sales = 0;
  let collected = 0;
  if (!offline) {
    const [{ data: saleRows }, { data: recoveryRows }] = await Promise.all([
      supabase
        .from("sale_invoices")
        .select("grand_total")
        .eq("company_id", company.id)
        .eq("created_by", user.id)
        .eq("status", "posted")
        .gte("invoice_date", from)
        .lte("invoice_date", today),
      supabase
        .from("recoveries")
        .select("amount")
        .eq("company_id", company.id)
        .eq("created_by", user.id)
        .gte("recovery_date", from)
        .lte("recovery_date", today),
    ]);
    sales = (saleRows || []).reduce((sum, row) => sum + Number(row.grand_total || 0), 0);
    collected = (recoveryRows || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  }

  return (
    <div className="animate-rise space-y-5">
      <FieldHeader
        title="Reports"
        description="Your figures this month, then the full report."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            My sales this month
          </p>
          <p className="mt-2 text-2xl font-semibold">{formatPkr(sales)}</p>
        </div>
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            My collections this month
          </p>
          <p className="mt-2 text-2xl font-semibold">{formatPkr(collected)}</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {links.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-start gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 transition hover:border-[var(--brand)]"
            >
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--brand-soft)] text-[var(--brand)]">
                <Icon className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-semibold">{item.label}</span>
                <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{item.hint}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
