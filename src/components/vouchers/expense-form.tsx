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
import { cn, formatPkr } from "@/lib/utils";
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

  function setCategory(key: string, category: ExpenseCategory | "") {
    setLines((prev) =>
      prev.map((l) =>
        l.key === key
          ? {
              ...l,
              category,
              salesman_id: isSalaryCategory(category) ? l.salesman_id : "",
            }
          : l,
      ),
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
      setError("Pick the salesman for each salary line.");
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
          salesman_id: isSalaryCategory(l.category) ? l.salesman_id : null,
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
      className="space-y-4"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >
      <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm leading-relaxed text-[var(--muted)]">
        Record company costs for the day — tea, fuel, rent, salary, etc. Salesman
        is only needed when the type is{" "}
        <span className="font-medium text-[var(--ink)]">Salesman salary</span>.
      </p>

      <div className="max-w-[12rem]">
        <Label>Date</Label>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>

      <div className="space-y-3">
        {lines.map((line, index) => {
          const salaryLine = isSalaryCategory(line.category);
          return (
            <div
              key={line.key}
              className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-white p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Line {index + 1}
                </p>
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50"
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
              </div>

              <div
                className={cn(
                  "grid gap-3",
                  salaryLine
                    ? "sm:grid-cols-2 lg:grid-cols-[1.1fr_1.1fr_7rem_1fr]"
                    : "sm:grid-cols-2 lg:grid-cols-[1.2fr_7rem_1fr]",
                )}
              >
                <div className={cn(!salaryLine && "sm:col-span-1 lg:col-span-1")}>
                  <Label>Type</Label>
                  <Select
                    value={line.category}
                    onChange={(e) =>
                      setCategory(line.key, e.target.value as ExpenseCategory | "")
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
                </div>

                {salaryLine ? (
                  <div>
                    <Label>Salesman</Label>
                    <Select
                      value={line.salesman_id}
                      required
                      onChange={(e) =>
                        updateLine(line.key, { salesman_id: e.target.value })
                      }
                      options={[
                        { value: "", label: "Select salesman" },
                        ...salesmen.map((s) => ({
                          value: s.user_id,
                          label: s.full_name || s.user_id.slice(0, 8),
                        })),
                      ]}
                    />
                  </div>
                ) : null}

                <div>
                  <Label>Amount</Label>
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
                </div>

                <div className={cn(!salaryLine && "sm:col-span-2 lg:col-span-1")}>
                  <Label>Remarks</Label>
                  <Input
                    value={line.remarks}
                    onChange={(e) =>
                      updateLine(line.key, { remarks: e.target.value })
                    }
                    placeholder={
                      salaryLine
                        ? "e.g. August salary"
                        : "e.g. tea, van diesel, lunch"
                    }
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setLines((p) => [...p, emptyLine()])}
        >
          <Plus className="h-4 w-4" />
          Add line
        </Button>
        <p className={cn("text-sm font-semibold text-[var(--ink)]")}>
          Total {formatPkr(total)}
        </p>
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
