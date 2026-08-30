import { PrintDocument } from "@/components/trading/print-document";
import { expenseCategoryLabel } from "@/lib/expenses/categories";
import { requireCompanyContext } from "@/lib/auth";
import { formatPkr } from "@/lib/utils";
import { notFound } from "next/navigation";

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, company } = await requireCompanyContext();

  const { data: expense } = await supabase
    .from("expenses")
    .select(
      "expense_no, expense_date, category, amount, remarks, salesman:salesmen!expenses_salesman_id_fkey(full_name)",
    )
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();

  if (!expense) notFound();

  const salesmanRel = expense.salesman as
    | { full_name: string | null }
    | { full_name: string | null }[]
    | null;
  const salesmanName = Array.isArray(salesmanRel)
    ? salesmanRel[0]?.full_name
    : salesmanRel?.full_name;

  return (
    <PrintDocument
      companyName={company.name}
      companyAddress={[company.address, company.city].filter(Boolean).join(", ")}
      title="Expense / Salary voucher"
      docNo={expense.expense_no}
      date={expense.expense_date}
      extraMeta={[
        { label: "Type", value: expenseCategoryLabel(expense.category) },
        { label: "Salesman", value: salesmanName || "—" },
        ...(expense.remarks
          ? [{ label: "Remarks", value: expense.remarks }]
          : []),
      ]}
      lines={[
        {
          product_code: expense.expense_no,
          product_name: [
            expenseCategoryLabel(expense.category),
            salesmanName,
            expense.remarks,
          ]
            .filter(Boolean)
            .join(" — "),
          qty: 1,
          amount: Number(expense.amount),
        },
      ]}
      totals={[{ label: "Amount", value: formatPkr(Number(expense.amount)) }]}
    />
  );
}
