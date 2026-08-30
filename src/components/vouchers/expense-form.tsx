"use client";

import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  EXPENSE_CATEGORIES,
  isSalaryCategory,
  type ExpenseCategory,
} from "@/lib/expenses/categories";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import type { SalesmanOption } from "@/lib/queries/salesmen";
import { createClient } from "@/lib/supabase/client";
import { formatPkr } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type Line = {
  key: string;
  category: ExpenseCategory | "";
  salesman_id: string;
  amount: string;
  remarks: string;
};

function emptyLine(): Line {
  return {
    key: crypto.randomUUID(),
    category: "",
    salesman_id: "",
    amount: "",
    remarks: "",
  };
}

export function ExpenseForm({
  companyId,
  organizationId,
  salesmen,
}: {
  companyId: string;
  organizationId: string;
  salesmen: SalesmanOption[];
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = lines.reduce((s, l) => s + Number(l.amount || 0), 0);

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const valid = lines.filter((l) => l.category && Number(l.amount) > 0);
    if (!valid.length) {
      setError("Add at least one line with type and amount.");
      return;
    }
    if (valid.some((l) => isSalaryCategory(l.category) && !l.salesman_id)) {
      setError("Salary must be tagged to a salesman.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("create_expenses", {
      p_payload: {
        organization_id: organizationId,
        company_id: companyId,
        expense_date: date,
        lines: valid.map((l) => ({
          category: l.category,
          amount: Number(l.amount),
          salesman_id: l.salesman_id || null,
          remarks: l.remarks || null,
        })),
      },
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    closeDialog?.();
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >
      <p className="rounded-lg bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--muted)]">
        Record what the company paid today — salesman salary, fuel, food, rent,
        or any other running cost. Each line posts to the expense ledger.
      </p>

      <div className="max-w-xs">
        <Label>Date</Label>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>

      <div className="table-grid">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="bg-[var(--surface-2)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
              <th className="px-3 py-2 w-52">Type</th>
              <th className="px-3 py-2 w-52">Salesman</th>
              <th className="px-3 py-2 w-32">Amount</th>
              <th className="px-3 py-2">Remarks</th>
              <th className="px-3 py-2 w-12" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">
                  <Select
                    value={line.category}
                    onChange={(e) =>
                      updateLine(line.key, {
                        category: e.target.value as ExpenseCategory | "",
                      })
                    }
                    required
                    options={[
                      { value: "", label: "Select type" },
                      ...EXPENSE_CATEGORIES.map((c) => ({
                        value: c.value,
                        label: c.label,
                      })),
                    ]}
                  />
                </td>
                <td className="px-3 py-2">
                  <Select
                    value={line.salesman_id}
                    required={isSalaryCategory(line.category)}
                    onChange={(e) =>
                      updateLine(line.key, { salesman_id: e.target.value })
                    }
                    options={[
                      {
                        value: "",
                        label: isSalaryCategory(line.category)
                          ? "Select salesman"
                          : "Company / unassigned",
                      },
                      ...salesmen.map((s) => ({
                        value: s.user_id,
                        label: s.full_name || s.user_id.slice(0, 8),
                      })),
                    ]}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.amount}
                    onChange={(e) =>
                      updateLine(line.key, { amount: e.target.value })
                    }
                    required
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={line.remarks}
                    onChange={(e) =>
                      updateLine(line.key, { remarks: e.target.value })
                    }
                    placeholder="e.g. van diesel, lunch"
                  />
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="rounded-lg p-2 text-rose-600 hover:bg-rose-50"
                    onClick={() =>
                      setLines((prev) =>
                        prev.length <= 1
                          ? [emptyLine()]
                          : prev.filter((l) => l.key !== line.key),
                      )
                    }
                    aria-label="Remove line"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setLines((p) => [...p, emptyLine()])}
        >
          <Plus className="h-4 w-4" />
          Add line
        </Button>
        <p className="text-sm font-semibold">Total {formatPkr(total)}</p>
      </div>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={loading}>
        {loading ? "Posting..." : "Save expenses"}
      </Button>
    </form>
  );
}
