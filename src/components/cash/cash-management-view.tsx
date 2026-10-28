"use client";

import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { useSyncStatus } from "@/components/offline/sync-provider";
import { Button } from "@/components/ui/button";
import {
  CreateDialogButton,
  PageHeading,
  useCreateDialogClose,
} from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PrintButton } from "@/components/ui/print-button";
import { RowActions } from "@/components/ui/row-actions";
import {
  type CashDesk,
  type CashLender,
  type CashLine,
  type CashSister,
  buildLocalCashDesk,
} from "@/lib/cash/local-cash-desk";
import { offlineAwareSubmit } from "@/lib/offline/offline-submit";
import { createClient } from "@/lib/supabase/client";
import { cn, formatPkr } from "@/lib/utils";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Building2,
  HandCoins,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const TZ = "Asia/Karachi";

function sheetDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function formatPrintedAt(now: Date) {
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: TZ,
  }).format(now);
  const time = new Intl.DateTimeFormat("en-PK", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: TZ,
  }).format(now);
  return { date, time };
}

function todayIso() {
  const shifted = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 10);
}

function lineHref(line: CashLine) {
  if (!line.ref_id) return null;
  if (line.source === "sale") return `/sales/invoices/${line.ref_id}`;
  if (line.source === "cash_receipt") return `/vouchers/cash-receipt/${line.ref_id}`;
  if (line.source === "recovery") return "/salesman/recoveries";
  if (line.source === "expense") return `/vouchers/expenses/${line.ref_id}`;
  if (line.source === "cash_payment") return `/vouchers/cash-payment/${line.ref_id}`;
  return null;
}

function sourceLabel(source: string) {
  switch (source) {
    case "sale":
      return "Paid sale";
    case "recovery":
    case "cash_receipt":
      return "Recovery";
    case "expense":
      return "Expense";
    case "cash_payment":
      return "Cash payment";
    case "opening":
      return "Opening";
    case "person_borrow":
    case "company_borrow":
      return "Borrow";
    case "person_repay":
    case "company_repay":
      return "Return";
    default:
      return source;
  }
}

function activityMark(source: string) {
  if (source === "person_borrow" || source === "company_borrow") {
    return {
      row: "bg-violet-50/70",
      badge: "bg-violet-100 text-violet-800",
      money: "text-violet-800",
    };
  }
  if (source === "person_repay" || source === "company_repay") {
    return {
      row: "bg-amber-50/80",
      badge: "bg-amber-100 text-amber-900",
      money: "text-amber-800",
    };
  }
  if (source === "opening") {
    return {
      row: "",
      badge: "bg-slate-100 text-slate-700",
      money: "text-slate-800",
    };
  }
  if (source === "expense") {
    return {
      row: "",
      badge: "bg-orange-50 text-orange-800",
      money: "text-rose-700",
    };
  }
  if (source === "cash_payment") {
    return {
      row: "",
      badge: "bg-rose-50 text-rose-800",
      money: "text-rose-700",
    };
  }
  if (source === "sale") {
    return {
      row: "",
      badge: "bg-emerald-50 text-emerald-800",
      money: "text-emerald-700",
    };
  }
  return {
    row: "",
    badge: "bg-sky-50 text-sky-800",
    money: "text-emerald-700",
  };
}

function readDesk(data: unknown, offline: boolean): CashDesk {
  const row = (data || {}) as Partial<CashDesk>;
  return {
    on_hand: Number(row.on_hand || 0),
    brought_forward: Number(row.brought_forward || 0),
    as_of: String(row.as_of || ""),
    from: String(row.from || ""),
    is_hub: Boolean(row.is_hub),
    lines: Array.isArray(row.lines) ? row.lines.map(readLine) : [],
    lenders: Array.isArray(row.lenders)
      ? row.lenders.map((lender) => ({
          id: String(lender.id),
          name: String(lender.name || ""),
          phone: lender.phone ? String(lender.phone) : null,
          is_active: lender.is_active !== false,
          outstanding: Number(lender.outstanding || 0),
        }))
      : [],
    sisters: Array.isArray(row.sisters)
      ? row.sisters.map((sister) => ({
          id: String(sister.id),
          name: String(sister.name || ""),
          on_hand: Number(sister.on_hand || 0),
          borrowed: Number(sister.borrowed || 0),
        }))
      : [],
    offline,
  };
}

function readLine(line: CashLine): CashLine {
  return {
    line_date: String(line.line_date || "").slice(0, 10),
    sort_at: line.sort_at ? String(line.sort_at) : null,
    source: String(line.source || ""),
    direction: line.direction === "out" ? "out" : "in",
    amount: Number(line.amount || 0),
    title: String(line.title || ""),
    sector: line.sector ? String(line.sector) : null,
    code: line.code ? String(line.code) : null,
    ref_id: line.ref_id ? String(line.ref_id) : null,
    movement_id: line.movement_id ? String(line.movement_id) : null,
    pair_id: line.pair_id ? String(line.pair_id) : null,
  };
}

export function CashManagementView({
  companyId,
  companyName,
  organizationId,
  canWrite,
}: {
  companyId: string;
  companyName: string;
  organizationId: string;
  canWrite: boolean;
}) {
  const today = todayIso();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState("");
  const [activity, setActivity] = useState<"all" | "recovery" | "paid" | "persons">("all");
  const [sector, setSector] = useState("");
  const [desk, setDesk] = useState<CashDesk | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openingAmount, setOpeningAmount] = useState("");
  const [openingDate, setOpeningDate] = useState(today);
  const [personName, setPersonName] = useState("");
  const [personPhone, setPersonPhone] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [borrowDate, setBorrowDate] = useState(today);
  const [borrowRemark, setBorrowRemark] = useState("");
  const [printedAt, setPrintedAt] = useState<Date | null>(null);
  const savedTitle = useRef("");
  const { online } = useSyncStatus();

  useEffect(() => {
    setPrintedAt(new Date());
    const onBeforePrint = () => {
      savedTitle.current = document.title;
      document.title = " ";
      setPrintedAt(new Date());
    };
    const onAfterPrint = () => {
      document.title = savedTitle.current;
    };
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const live = online && (typeof navigator === "undefined" || navigator.onLine);
    try {
      if (!live) {
        setDesk(await buildLocalCashDesk(companyId, from, to));
        return;
      }
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("get_cash_desk", {
        p_company_id: companyId,
        p_as_of: to,
        p_from: from,
      });
      if (rpcError) throw new Error(rpcError.message);
      setDesk(readDesk(data, false));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load cash";
      if (/fetch|network|offline/i.test(message)) {
        setDesk(await buildLocalCashDesk(companyId, from, to));
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [companyId, from, online, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const sectorOptions = useMemo(() => {
    const names = new Set<string>();
    if (sector) names.add(sector);
    for (const line of desk?.lines || []) {
      if (line.sector) names.add(line.sector);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [desk, sector]);

  const filteredView = activity !== "all" || Boolean(sector);

  const rows = useMemo(() => {
    const lines = desk?.lines || [];
    let running = Number(desk?.brought_forward || 0);
    const withBalance = lines.map((line) => {
      running += line.direction === "in" ? line.amount : -line.amount;
      return { ...line, balance: running };
    });
    const q = search.trim().toLowerCase();
    const narrowed = withBalance.filter((line) => {
      if (activity === "recovery" && line.source !== "recovery" && line.source !== "cash_receipt") return false;
      if (activity === "paid" && line.source !== "sale") return false;
      if (activity === "persons" && line.source !== "person_borrow" && line.source !== "person_repay") return false;
      if (sector && activity !== "persons" && line.sector !== sector) return false;
      if (!q) return true;
      return [line.title, line.code, line.sector, sourceLabel(line.source)].join(" ").toLowerCase().includes(q);
    });
    if (activity === "all" && !sector) return narrowed;
    let viewRunning = 0;
    return narrowed.map((line) => {
      viewRunning += line.direction === "in" ? line.amount : -line.amount;
      return { ...line, balance: viewRunning };
    });
  }, [activity, desk, search, sector]);

  const totals = useMemo(() => {
    const lines = desk?.lines || [];
    const sum = (sources: string[], direction?: "in" | "out") =>
      lines.reduce((total, line) => {
        if (!sources.includes(line.source)) return total;
        if (direction && line.direction !== direction) return total;
        return total + line.amount;
      }, 0);
    return {
      received: sum(["sale", "recovery", "cash_receipt"]),
      expenses: sum(["expense"]),
      cashPaid: sum(["cash_payment"]),
      borrowed: sum(["person_borrow", "company_borrow"], "in"),
      returned: sum(["person_repay", "company_repay"], "out"),
    };
  }, [desk]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function saveOpening() {
    return run(async () => {
      await offlineAwareSubmit({
        mutationType: "cash_opening",
        companyId,
        organizationId,
        payload: {
          company_id: companyId,
          organization_id: organizationId,
          amount: Number(openingAmount || 0),
          movement_date: openingDate,
        },
      });
    });
  }

  function addPerson() {
    return run(async () => {
      const saved = await offlineAwareSubmit({
        mutationType: "cash_lender",
        companyId,
        organizationId,
        payload: {
          company_id: companyId,
          organization_id: organizationId,
          name: personName.trim(),
          phone: personPhone.trim(),
        },
      });
      const amount = Number(borrowAmount || 0);
      if (amount > 0 && saved.id) {
        await offlineAwareSubmit({
          mutationType: "person_cash",
          companyId,
          organizationId,
          payload: {
            company_id: companyId,
            organization_id: organizationId,
            lender_id: saved.id,
            kind: "person_borrow",
            amount,
            movement_date: borrowDate,
            remarks: borrowRemark,
          },
        });
      }
      setPersonName("");
      setPersonPhone("");
      setBorrowAmount("");
      setBorrowRemark("");
    });
  }

  function personCash(lenderId: string, kind: "person_borrow" | "person_repay", form: HTMLFormElement) {
    const data = new FormData(form);
    return run(async () => {
      await offlineAwareSubmit({
        mutationType: "person_cash",
        companyId,
        organizationId,
        payload: {
          company_id: companyId,
          organization_id: organizationId,
          lender_id: lenderId,
          kind,
          amount: Number(data.get("amount") || 0),
          movement_date: String(data.get("date") || to),
          remarks: String(data.get("remarks") || ""),
        },
      });
      form.reset();
    });
  }

  async function deleteMovement(id: string) {
    await offlineAwareSubmit({
      mutationType: "cash_movement_delete",
      companyId,
      organizationId,
      payload: { id },
    });
    await load();
  }

  async function updateMovement(id: string, amount: number, date: string, remarks: string) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("Connect to the internet to edit this entry.");
    }
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("update_cash_movement", {
      p_payload: {
        id,
        amount,
        movement_date: date,
        remarks,
      },
    });
    if (rpcError) throw new Error(rpcError.message);
    await load();
  }

  function companyLoan(sisterId: string, action: "borrow" | "repay", form: HTMLFormElement) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setError("Connect to the internet to move cash between companies.");
      return;
    }
    const data = new FormData(form);
    return run(async () => {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("save_company_cash_loan", {
        p_payload: {
          company_id: companyId,
          counterparty_company_id: sisterId,
          action,
          amount: Number(data.get("amount") || 0),
          movement_date: String(data.get("date") || to),
          remarks: String(data.get("remarks") || ""),
        },
      });
      if (rpcError) throw new Error(rpcError.message);
      form.reset();
    });
  }

  async function deleteCompanyLoan(pairId: string) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("Connect to the internet to move cash between companies.");
    }
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("delete_company_cash_loan", {
      p_payload: { pair_id: pairId },
    });
    if (rpcError) throw new Error(rpcError.message);
    await load();
  }

  const onHand = Number(desk?.on_hand || 0);
  const lenders = desk?.lenders || [];
  const sisters = desk?.sisters || [];

  return (
    <div className="space-y-5">
      <PageHeading
        title="Cash management"
        description={`${companyName}. On-hand cash is money received from recoveries and paid bills, minus expenses and cash payments.`}
        actions={
          <>
            {canWrite ? (
              <CreateDialogButton label="Add person" title="Add person" description="Someone you borrow cash from. This is not a shop and does not change a ledger." size="md">
                <PersonForm
                  busy={busy}
                  name={personName}
                  phone={personPhone}
                  amount={borrowAmount}
                  date={borrowDate}
                  remark={borrowRemark}
                  onName={setPersonName}
                  onPhone={setPersonPhone}
                  onAmount={setBorrowAmount}
                  onDate={setBorrowDate}
                  onRemark={setBorrowRemark}
                  onSave={addPerson}
                />
              </CreateDialogButton>
            ) : null}
            {canWrite ? (
              <CreateDialogButton label="Borrow or return" title="Borrow or return" description="Cash from a saved person. The entry is listed in the cash book." size="md">
                <PersonMoveForm
                  busy={busy}
                  date={to}
                  lenders={lenders}
                  lines={desk?.lines || []}
                  onSave={(lenderId, kind, form) => personCash(lenderId, kind, form)}
                />
              </CreateDialogButton>
            ) : null}
            {canWrite ? (
              <CreateDialogButton
                label="Borrow from company"
                title="Borrow from company"
                description="Only the main company can take or return cash from another company in this organization. Both sides are recorded."
                size="md"
              >
                <CompanyMoveForm
                  busy={busy}
                  date={to}
                  isHub={Boolean(desk?.is_hub)}
                  offline={Boolean(desk?.offline)}
                  sisters={sisters}
                  lines={desk?.lines || []}
                  onSave={(sisterId, action, form) => companyLoan(sisterId, action, form)}
                />
              </CreateDialogButton>
            ) : null}
            {canWrite ? (
              <CreateDialogButton label="Opening cash" title="Opening cash" description="Notes already in the drawer. Saving again corrects this amount. It is not added twice." size="sm">
                <OpeningForm
                  busy={busy}
                  amount={openingAmount}
                  date={openingDate}
                  onAmount={setOpeningAmount}
                  onDate={setOpeningDate}
                  onSave={saveOpening}
                />
              </CreateDialogButton>
            ) : null}
          </>
        }
      />

      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {onHand < -0.009 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          On-hand cash is below zero. Check opening cash, expenses, and cash payments.
        </p>
      ) : null}
      {desk?.offline ? (
        <p className="text-sm text-[var(--muted)]">
          Showing this computer’s copy. Company borrowing needs a connection.
        </p>
      ) : null}

      <StatsGrid fluid>
        <StatCard label="On hand" value={onHand} format="money" icon={Banknote} tone={onHand < 0 ? "danger" : "ok"} hint="Cash in the drawer" />
        <StatCard label="Brought forward" value={Number(desk?.brought_forward || 0)} format="money" icon={Wallet} hint="Before the from date" />
        <StatCard label="Received" value={totals.received} format="money" icon={ArrowDownLeft} tone="ok" hint="Paid bills and recoveries" />
        <StatCard label="Expenses" value={totals.expenses} format="money" icon={ArrowUpRight} tone="warn" />
        <StatCard label="Cash paid" value={totals.cashPaid} format="money" icon={HandCoins} tone="warn" hint="Cash payments only" />
        <StatCard label="Borrowed" value={totals.borrowed} format="money" icon={Building2} hint={`Returned ${formatPkr(totals.returned)}`} />
      </StatsGrid>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Cash book</h2>
          <p className="text-sm text-[var(--muted)]">Recoveries, paid bills, expenses, and borrows in these dates.</p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-medium">
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800">In · received</span>
            <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-800">Out · paid</span>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-violet-800">Borrow</span>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">Return</span>
          </div>
        </div>
        <div className="no-print">
          <PrintButton label="Print" printId="cash-management" />
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <Label>From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <Label>Show</Label>
          <Select
            value={activity}
            onChange={(e) => setActivity(e.target.value as "all" | "recovery" | "paid" | "persons")}
            options={[
              { value: "all", label: "All activity" },
              { value: "recovery", label: "Recovery" },
              { value: "paid", label: "Paid bills" },
              { value: "persons", label: "Persons" },
            ]}
          />
        </div>
        <div>
          <Label>Sector</Label>
          <Select
            value={activity === "persons" ? "" : sector}
            disabled={activity === "persons"}
            onChange={(e) => setSector(e.target.value)}
            options={[
              { value: "", label: activity === "persons" ? "Not used for persons" : "All sectors" },
              ...sectorOptions.map((name) => ({ value: name, label: name })),
            ]}
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-1">
          <Label>Search</Label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-[var(--paper)] text-left text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Detail</th>
              <th className="px-3 py-2 text-right font-medium">In</th>
              <th className="px-3 py-2 text-right font-medium">Out</th>
              <th className="px-3 py-2 text-right font-medium">{filteredView ? "In this view" : "Balance"}</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredView ? null : (
              <tr className="border-t border-[var(--border)]">
                <td className="px-3 py-2" colSpan={5}>Brought forward</td>
                <td className="px-3 py-2 text-right">{formatPkr(Number(desk?.brought_forward || 0))}</td>
                <td />
              </tr>
            )}
            {loading ? (
              <tr>
                <td className="px-3 py-6 text-[var(--muted)]" colSpan={7}>Loading cash book…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-[var(--muted)]" colSpan={7}>
                  {activity === "recovery"
                    ? "No recovery in these dates."
                    : activity === "paid"
                      ? "No paid bills in these dates."
                      : activity === "persons"
                        ? "No person borrow or return in these dates."
                        : sector
                          ? `No recovery or paid bills in ${sector}.`
                          : "No cash movement in these dates."}
                </td>
              </tr>
            ) : (
              rows.map((line, index) => {
                const href = lineHref(line);
                const mark = activityMark(line.source);
                const moneyIn = line.direction === "in";
                return (
                  <tr key={`${line.movement_id || line.ref_id || index}-${line.source}`} className={cn("border-t border-[var(--border)]", mark.row)}>
                    <td className="px-3 py-2 tabular-nums">{sheetDate(line.line_date)}</td>
                    <td className="px-3 py-2">
                      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", mark.badge)}>
                        {sourceLabel(line.source)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex min-w-0 items-baseline gap-2">
                        {line.code ? (
                          <span className="shrink-0 rounded-md bg-[var(--paper)] px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide text-[var(--ink)]">
                            {line.code}
                          </span>
                        ) : null}
                        {href ? (
                          <Link href={href} className="text-[var(--brand)]">
                            {line.title}
                          </Link>
                        ) : (
                          <span>{line.title}</span>
                        )}
                      </div>
                      {line.sector ? (
                        <p className="mt-0.5 text-xs text-[var(--muted)]">{line.sector}</p>
                      ) : null}
                    </td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", moneyIn ? cn("font-semibold", mark.money) : "text-[var(--muted)]")}>
                      {moneyIn ? formatPkr(line.amount) : "—"}
                    </td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", !moneyIn ? cn("font-semibold", mark.money) : "text-[var(--muted)]")}>
                      {moneyIn ? "—" : formatPkr(line.amount)}
                    </td>
                    <td className={cn("px-3 py-2 text-right font-medium tabular-nums", line.balance < -0.009 ? "text-rose-700" : "")}>
                      {formatPkr(line.balance)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <CashLineActions
                        line={line}
                        canWrite={canWrite}
                        isHub={Boolean(desk?.is_hub)}
                        onDeleteMovement={deleteMovement}
                        onDeleteCompany={deleteCompanyLoan}
                        onUpdate={updateMovement}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div data-print-id="cash-management" className="print-only print-sheet report-print">
        <div className="recovery-sheet-head">
          <div className="recovery-sheet-head-top">
            <p className="recovery-sheet-title">Cash management</p>
            <p className="recovery-sheet-co">{companyName}</p>
          </div>
          <div className="recovery-sheet-head-body">
            <div className="recovery-sheet-meta">
              <p>
                <span>On hand</span> <strong>{formatPkr(onHand)}</strong>
              </p>
              <p>
                <span>Brought forward</span> {formatPkr(Number(desk?.brought_forward || 0))}
              </p>
              <p>
                <span>Received</span> {formatPkr(totals.received)}
              </p>
              <p>
                <span>Expenses</span> {formatPkr(totals.expenses)}
                <span style={{ marginLeft: "6mm" }}>Cash paid</span> {formatPkr(totals.cashPaid)}
              </p>
              <p>
                <span>Borrowed</span> {formatPkr(totals.borrowed)}
                <span style={{ marginLeft: "6mm" }}>Returned</span> {formatPkr(totals.returned)}
              </p>
            </div>
            <div className="recovery-sheet-dates">
              <p>
                <span>Show</span>{" "}
                {activity === "recovery"
                  ? "Recovery"
                  : activity === "paid"
                    ? "Paid bills"
                    : activity === "persons"
                      ? "Persons"
                      : "All activity"}
              </p>
              {sector && activity !== "persons" ? (
                <p>
                  <span>Sector</span> {sector}
                </p>
              ) : null}
              <p>
                <span>From</span> {sheetDate(from)}
                <span className="recovery-sheet-dates__to">To</span> {sheetDate(to)}
              </p>
              <p className="recovery-sheet-printed">
                {printedAt
                  ? `${formatPrintedAt(printedAt).date} ${formatPrintedAt(printedAt).time}`
                  : ""}
              </p>
              {search.trim() ? <p>Search: {search.trim()}</p> : null}
            </div>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th className="num" style={{ width: "8mm" }}>#</th>
              <th>Date</th>
              <th>Source</th>
              <th>Detail</th>
              <th className="num">In</th>
              <th className="num">Out</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {filteredView ? null : (
              <tr>
                <td className="num" />
                <td colSpan={3}>Brought forward</td>
                <td />
                <td />
                <td className="num">{formatPkr(Number(desk?.brought_forward || 0))}</td>
              </tr>
            )}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7}>No cash movement in these dates.</td>
              </tr>
            ) : (
              rows.map((line, index) => (
                <tr key={`print-${line.movement_id || line.ref_id || index}-${line.source}`}>
                  <td className="num">{index + 1}</td>
                  <td>{sheetDate(line.line_date)}</td>
                  <td>{sourceLabel(line.source)}</td>
                  <td>{[line.code, line.title, line.sector].filter(Boolean).join(" · ")}</td>
                  <td className="num">{line.direction === "in" ? formatPkr(line.amount) : ""}</td>
                  <td className="num">{line.direction === "out" ? formatPkr(line.amount) : ""}</td>
                  <td className="num">{formatPkr(line.balance)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="report-print-foot">
          <span>Umar Distribution Software</span>
          <span>Computer-generated report</span>
        </div>
      </div>
    </div>
  );
}

function CashLineActions({
  line,
  canWrite,
  isHub,
  onDeleteMovement,
  onDeleteCompany,
  onUpdate,
}: {
  line: CashLine & { balance: number };
  canWrite: boolean;
  isHub: boolean;
  onDeleteMovement: (id: string) => Promise<void>;
  onDeleteCompany: (pairId: string) => Promise<void>;
  onUpdate: (id: string, amount: number, date: string, remarks: string) => Promise<void>;
}) {
  const href = lineHref(line);
  const own =
    line.movement_id &&
    (line.source === "opening" || line.source === "person_borrow" || line.source === "person_repay");
  const company = Boolean(line.pair_id && line.movement_id && isHub);
  const canChange = canWrite && (own || company);

  return (
    <RowActions
      viewTitle={line.title}
      href={href || undefined}
      viewFields={[
        { label: "Date", value: sheetDate(line.line_date) },
        { label: "Source", value: sourceLabel(line.source) },
        { label: "Code", value: line.code || "—" },
        { label: "Detail", value: line.title },
        { label: "Sector", value: line.sector || "—" },
        { label: "In", value: line.direction === "in" ? formatPkr(line.amount) : "—" },
        { label: "Out", value: line.direction === "out" ? formatPkr(line.amount) : "—" },
        { label: "Balance", value: formatPkr(line.balance) },
      ]}
      allowEdit={canChange}
      editTitle={`Edit ${line.title}`}
      editClassName="max-w-md"
      editContent={
        canChange
          ? (close) => (
              <CashLineEditForm
                line={line}
                onSave={async (amount, date, remarks) => {
                  await onUpdate(line.movement_id!, amount, date, remarks);
                  close();
                }}
              />
            )
          : undefined
      }
      allowDelete={canChange}
      onDelete={
        canChange
          ? () => (company ? onDeleteCompany(line.pair_id!) : onDeleteMovement(line.movement_id!))
          : undefined
      }
      deleteTitle={company ? "Remove this company loan?" : "Delete this cash entry?"}
      deleteDescription={
        company
          ? "This removes the loan from both companies."
          : "This removes the entry from the cash book. Sales, expenses, and vouchers are not changed."
      }
      deleteConfirmLabel="Delete entry"
    />
  );
}

function CashLineEditForm({
  line,
  onSave,
}: {
  line: CashLine;
  onSave: (amount: number, date: string, remarks: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(line.amount));
  const [date, setDate] = useState(line.line_date);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!line.movement_id) return;
    let cancelled = false;
    void createClient()
      .from("cash_movements")
      .select("remarks")
      .eq("id", line.movement_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setRemarks(data?.remarks ? String(data.remarks) : "");
      });
    return () => {
      cancelled = true;
    };
  }, [line.movement_id]);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onSave(Number(amount), date, remarks);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not save");
          setBusy(false);
        }
      }}
    >
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      <div>
        <Label>Amount</Label>
        <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </div>
      <div>
        <Label>Date</Label>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </div>
      <div>
        <Label>Remark</Label>
        <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </div>
      <Button type="submit" loading={busy}>Save</Button>
    </form>
  );
}

function PersonForm({
  busy,
  name,
  phone,
  amount,
  date,
  remark,
  onName,
  onPhone,
  onAmount,
  onDate,
  onRemark,
  onSave,
}: {
  busy: boolean;
  name: string;
  phone: string;
  amount: string;
  date: string;
  remark: string;
  onName: (value: string) => void;
  onPhone: (value: string) => void;
  onAmount: (value: string) => void;
  onDate: (value: string) => void;
  onRemark: (value: string) => void;
  onSave: () => Promise<boolean>;
}) {
  const close = useCreateDialogClose();
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSave()) close?.();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => onName(e.target.value)} required />
        </div>
        <div>
          <Label>Phone</Label>
          <Input value={phone} onChange={(e) => onPhone(e.target.value)} />
        </div>
        <div>
          <Label>Amount borrowed now</Label>
          <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => onAmount(e.target.value)} placeholder="Optional" />
        </div>
        <div>
          <Label>Date</Label>
          <Input type="date" value={date} onChange={(e) => onDate(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label>Remark</Label>
          <Input value={remark} onChange={(e) => onRemark(e.target.value)} />
        </div>
      </div>
      <Button type="submit" loading={busy}>Save person</Button>
    </form>
  );
}

function OpeningForm({
  busy,
  amount,
  date,
  onAmount,
  onDate,
  onSave,
}: {
  busy: boolean;
  amount: string;
  date: string;
  onAmount: (value: string) => void;
  onDate: (value: string) => void;
  onSave: () => Promise<boolean>;
}) {
  const close = useCreateDialogClose();
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSave()) close?.();
      }}
    >
      <div>
        <Label>Amount</Label>
        <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => onAmount(e.target.value)} required />
      </div>
      <div>
        <Label>Date</Label>
        <Input type="date" value={date} onChange={(e) => onDate(e.target.value)} required />
      </div>
      <Button type="submit" loading={busy}>Save opening</Button>
    </form>
  );
}

const fieldClass =
  "h-9 w-full rounded-lg border border-[var(--border)] bg-white px-2 text-sm";

function HistoryTable({ lines }: { lines: CashLine[] }) {
  if (lines.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No entry in these dates yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--paper)] text-left text-[var(--muted)]">
          <tr>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Detail</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={`${line.movement_id || index}`} className="border-t border-[var(--border)]">
              <td className="px-3 py-2">{line.line_date}</td>
              <td className="px-3 py-2">{line.title}</td>
              <td className="px-3 py-2 text-right">
                {line.direction === "out" ? "−" : ""}
                {formatPkr(line.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PersonMoveForm({
  busy,
  date,
  lenders,
  lines,
  onSave,
}: {
  busy: boolean;
  date: string;
  lenders: CashLender[];
  lines: CashLine[];
  onSave: (
    lenderId: string,
    kind: "person_borrow" | "person_repay",
    form: HTMLFormElement,
  ) => Promise<boolean | undefined> | undefined;
}) {
  const close = useCreateDialogClose();
  const [lenderId, setLenderId] = useState(lenders[0]?.id || "");
  const [kind, setKind] = useState<"person_borrow" | "person_repay">("person_borrow");
  const lender = lenders.find((row) => row.id === lenderId);
  const history = lines.filter(
    (line) =>
      (line.source === "person_borrow" || line.source === "person_repay") &&
      lender &&
      line.title.toLowerCase().includes(lender.name.toLowerCase()),
  );

  if (lenders.length === 0) {
    return <p className="text-sm text-[var(--muted)]">Add a person first. Then borrow or return from here.</p>;
  }

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await onSave(lenderId, kind, e.currentTarget);
        if (ok) close?.();
      }}
    >
      <div>
        <Label>Person</Label>
        <select className={fieldClass} value={lenderId} onChange={(e) => setLenderId(e.target.value)}>
          {lenders.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name} · owed {formatPkr(row.outstanding)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label>What to do</Label>
        <select className={fieldClass} value={kind} onChange={(e) => setKind(e.target.value as "person_borrow" | "person_repay")}>
          <option value="person_borrow">Borrow</option>
          <option value="person_repay">Return</option>
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Amount</Label>
          <Input name="amount" type="number" min="0.01" step="0.01" required />
        </div>
        <div>
          <Label>Date</Label>
          <Input name="date" type="date" defaultValue={date} required />
        </div>
      </div>
      <div>
        <Label>Remark</Label>
        <Input name="remarks" />
      </div>
      <Button type="submit" loading={busy}>{kind === "person_borrow" ? "Borrow" : "Return"}</Button>
      <div className="space-y-2 pt-2">
        <p className="text-sm font-medium">History</p>
        <HistoryTable lines={history} />
      </div>
    </form>
  );
}

function CompanyMoveForm({
  busy,
  date,
  isHub,
  offline,
  sisters,
  lines,
  onSave,
}: {
  busy: boolean;
  date: string;
  isHub: boolean;
  offline: boolean;
  sisters: CashSister[];
  lines: CashLine[];
  onSave: (
    sisterId: string,
    action: "borrow" | "repay",
    form: HTMLFormElement,
  ) => Promise<boolean | undefined> | undefined;
}) {
  const close = useCreateDialogClose();
  const [sisterId, setSisterId] = useState(sisters[0]?.id || "");
  const [action, setAction] = useState<"borrow" | "repay">("borrow");
  const sister = sisters.find((row) => row.id === sisterId);
  const history = lines.filter(
    (line) =>
      (line.source === "company_borrow" || line.source === "company_repay") &&
      sister &&
      line.title.toLowerCase().includes(sister.name.toLowerCase()),
  );

  if (offline) {
    return <p className="text-sm text-[var(--muted)]">Connect to the internet to move cash between companies.</p>;
  }
  if (!isHub) {
    return <p className="text-sm text-[var(--muted)]">Open the main company to borrow from another company.</p>;
  }
  if (sisters.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No other company is in this organization.</p>;
  }

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await onSave(sisterId, action, e.currentTarget);
        if (ok) close?.();
      }}
    >
      <div>
        <Label>Company</Label>
        <select className={fieldClass} value={sisterId} onChange={(e) => setSisterId(e.target.value)}>
          {sisters.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name} · on hand {formatPkr(row.on_hand)} · borrowed {formatPkr(row.borrowed)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label>What to do</Label>
        <select className={fieldClass} value={action} onChange={(e) => setAction(e.target.value as "borrow" | "repay")}>
          <option value="borrow">Borrow</option>
          <option value="repay">Return</option>
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Amount</Label>
          <Input name="amount" type="number" min="0.01" step="0.01" required />
        </div>
        <div>
          <Label>Date</Label>
          <Input name="date" type="date" defaultValue={date} required />
        </div>
      </div>
      <div>
        <Label>Remark</Label>
        <Input name="remarks" />
      </div>
      <Button type="submit" loading={busy}>{action === "borrow" ? "Borrow" : "Return"}</Button>
      <div className="space-y-2 pt-2">
        <p className="text-sm font-medium">History</p>
        <HistoryTable lines={history} />
      </div>
    </form>
  );
}
