"use client";

import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  SYSTEM_EXPENSE_CATEGORIES,
  isBuiltyCategory,
  isSalaryCategory,
} from "@/lib/expenses/categories";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import { useSingleSubmit } from "@/lib/forms/single-submit";
import { offlineAwareSubmit } from "@/lib/offline/offline-submit";
import {
  createExpenseCategory,
  fetchExpenseCategories,
  type ExpenseCategoryRow,
} from "@/lib/queries/expense-categories";
import type { SalesmanOption } from "@/lib/queries/salesmen";
import { createClient } from "@/lib/supabase/client";
import type { Party, Warehouse } from "@/lib/types/database";
import { AMOUNT_PLACEHOLDER, AMOUNT_STEP, cn, formatPkr } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

const ADD_CUSTOM_VALUE = "__add_custom__";

type Line = {
  key: string;
  category: string;
  salesman_id: string;
  warehouse_id: string;
  vendor_id: string;
  amount: string;
  remarks: string;
};

function emptyLine(): Line {
  return {
    key: crypto.randomUUID(),
    category: "",
    salesman_id: "",
    warehouse_id: "",
    vendor_id: "",
    amount: "",
    remarks: "",
  };
}

export function ExpenseForm({
  companyId,
  organizationId,
  salesmen,
  warehouses,
  vendors,
  onDone,
}: {
  companyId: string;
  organizationId: string;
  salesmen: SalesmanOption[];
  warehouses: Warehouse[];
  vendors: Party[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [loading, setLoading] = useState(false);
  const singleSubmit = useSingleSubmit();
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<ExpenseCategoryRow[]>(
    SYSTEM_EXPENSE_CATEGORIES.map((c) => ({ ...c, is_system: true })),
  );
  const [addingCustomFor, setAddingCustomFor] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [savingCustom, setSavingCustom] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const rows = await fetchExpenseCategories(supabase, companyId);
        if (!cancelled && rows.length) setCategories(rows);
      } catch {
        // Keep system defaults.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const vendorOptions = useMemo(
    () =>
      vendors.map((v) => ({
        value: v.id,
        label: `${v.party_code} — ${v.name_en}`,
      })),
    [vendors],
  );

  const categoryOptions = useMemo(
    () => [
      { value: "", label: "Select type" },
      ...categories.map((c) => ({
        value: c.value,
        label: c.label,
      })),
      { value: ADD_CUSTOM_VALUE, label: "+ Add custom type…" },
    ],
    [categories],
  );

  const total = lines.reduce((s, l) => s + Number(l.amount || 0), 0);

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  }

  function setCategory(key: string, category: string) {
    if (category === ADD_CUSTOM_VALUE) {
      setAddingCustomFor(key);
      setCustomLabel("");
      setError(null);
      return;
    }
    setAddingCustomFor((prev) => (prev === key ? null : prev));
    setLines((prev) =>
      prev.map((l) =>
        l.key === key
          ? {
              ...l,
              category,
              salesman_id: isSalaryCategory(category) ? l.salesman_id : "",
              warehouse_id: isBuiltyCategory(category) ? l.warehouse_id : "",
              vendor_id: isBuiltyCategory(category) ? l.vendor_id : "",
            }
          : l,
      ),
    );
  }

  async function saveCustomCategory(lineKey: string) {
    const label = customLabel.trim();
    if (label.length < 2) {
      setError("Enter a category name (at least 2 characters).");
      return;
    }
    setSavingCustom(true);
    setError(null);
    try {
      const supabase = createClient();
      const created = await createExpenseCategory(supabase, {
        organization_id: organizationId,
        company_id: companyId,
        label,
      });
      setCategories((prev) => {
        if (prev.some((c) => c.value === created.value)) {
          return prev.map((c) =>
            c.value === created.value ? { ...c, ...created } : c,
          );
        }
        return [...prev, created];
      });
      setCategory(lineKey, created.value);
      setAddingCustomFor(null);
      setCustomLabel("");
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSavingCustom(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await singleSubmit(async () => {
      if (loading) return;
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
      if (
        valid.some(
          (l) =>
            isBuiltyCategory(l.category) && (!l.warehouse_id || !l.vendor_id),
        )
      ) {
        setError("Pick company and vendor for each builty expense line.");
        return;
      }

      setLoading(true);
      try {
        await offlineAwareSubmit({
          mutationType: "expense",
          companyId,
          organizationId,
          payload: {
            organization_id: organizationId,
            company_id: companyId,
            expense_date: date,
            lines: valid.map((l) => ({
              category: l.category,
              amount: Number(l.amount),
              salesman_id: isSalaryCategory(l.category) ? l.salesman_id : null,
              warehouse_id: isBuiltyCategory(l.category)
                ? l.warehouse_id
                : null,
              vendor_id: isBuiltyCategory(l.category) ? l.vendor_id : null,
              remarks: l.remarks || null,
            })),
          },
        });

        setLoading(false);
        closeDialog?.();
        onDone?.();
        router.refresh();
      } catch (err: any) {
        setLoading(false);
        setError(err?.message || String(err));
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >
      <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm leading-relaxed text-[var(--muted)]">
        Record company costs for the day — tea, fuel, rent, salary, builty, etc.
        You can also add your own expense type. Salesman is only needed for{" "}
        <span className="font-medium text-[var(--ink)]">Salesman salary</span>.
        Company and vendor are required for{" "}
        <span className="font-medium text-[var(--ink)]">Builty expense</span>.
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
          const builtyLine = isBuiltyCategory(line.category);
          const showCustom = addingCustomFor === line.key;
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
                  onClick={() => {
                    setAddingCustomFor((prev) =>
                      prev === line.key ? null : prev,
                    );
                    setLines((prev) =>
                      prev.length <= 1
                        ? [emptyLine()]
                        : prev.filter((l) => l.key !== line.key),
                    );
                  }}
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <Label>Type</Label>
                  <Select
                    value={showCustom ? "" : line.category}
                    onChange={(e) => setCategory(line.key, e.target.value)}
                    required={!showCustom}
                    options={categoryOptions}
                  />
                </div>

                {showCustom ? (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Label>New category name</Label>
                    <div className="flex flex-wrap items-end gap-2">
                      <Input
                        value={customLabel}
                        onChange={(e) => setCustomLabel(e.target.value)}
                        placeholder="e.g. Shop rent, Tea, Generator diesel"
                        autoFocus
                        className="min-w-[12rem] flex-1"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void saveCustomCategory(line.key);
                          }
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        loading={savingCustom}
                        onClick={() => void saveCustomCategory(line.key)}
                      >
                        Save type
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={savingCustom}
                        onClick={() => {
                          setAddingCustomFor(null);
                          setCustomLabel("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}

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

                {builtyLine ? (
                  <>
                    <div>
                      <Label>Company</Label>
                      <Select
                        value={line.warehouse_id}
                        required
                        onChange={(e) =>
                          updateLine(line.key, {
                            warehouse_id: e.target.value,
                          })
                        }
                        options={[
                          { value: "", label: "Select company" },
                          ...warehouses.map((w) => ({
                            value: w.id,
                            label: w.name,
                          })),
                        ]}
                      />
                    </div>
                    <div>
                      <Label>Vendor</Label>
                      <Select
                        value={line.vendor_id}
                        required
                        onChange={(e) =>
                          updateLine(line.key, { vendor_id: e.target.value })
                        }
                        options={[
                          { value: "", label: "Select vendor" },
                          ...vendorOptions,
                        ]}
                      />
                    </div>
                  </>
                ) : null}

                {!showCustom ? (
                  <div>
                    <Label>Amount</Label>
                    <Input
                      type="number"
                      min="0"
                      step={AMOUNT_STEP}
                      placeholder={AMOUNT_PLACEHOLDER}
                      value={line.amount}
                      onChange={(e) =>
                        updateLine(line.key, { amount: e.target.value })
                      }
                      required
                    />
                  </div>
                ) : null}

                {!showCustom ? (
                  <div
                    className={cn(
                      !salaryLine && !builtyLine && "sm:col-span-1",
                      builtyLine && "sm:col-span-2 lg:col-span-2",
                    )}
                  >
                    <Label>Remarks</Label>
                    <Input
                      value={line.remarks}
                      onChange={(e) =>
                        updateLine(line.key, { remarks: e.target.value })
                      }
                      placeholder={
                        salaryLine
                          ? "e.g. August salary"
                          : builtyLine
                            ? "e.g. freight bilty no."
                            : "e.g. tea, van diesel, lunch"
                      }
                    />
                  </div>
                ) : null}
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

      <Button type="submit" loading={loading} disabled={Boolean(addingCustomFor)}>
        {loading ? "Posting..." : "Save expenses"}
      </Button>
    </form>
  );
}
