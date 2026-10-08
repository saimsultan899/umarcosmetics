"use client";

import { PartyCodePicker } from "@/components/forms/party-code-picker";
import { SalesmanSelect } from "@/components/forms/salesman-select";
import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { focusField, handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import { offlineAwareSubmit } from "@/lib/offline/offline-submit";
import { createClient } from "@/lib/supabase/client";
import type { Party } from "@/lib/types/database";
import type { SalesmanOption } from "@/lib/queries/salesmen";
import { AMOUNT_PLACEHOLDER, AMOUNT_STEP, formatNumber, formatPkr } from "@/lib/utils";
import {
  findSameDayRecoveries,
  formatRecoveryWhen,
  type SameDayRecovery,
} from "@/lib/vouchers/same-day-recovery";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

type RecoveryLine = {
  key: string;
  requestId?: string;
  partyId: string;
  partyCode: string;
  partyName: string;
  amount: number;
  remarks: string;
  owed: number | null;
};

function newKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type SheetShop = {
  id: string;
  code: string;
  name: string;
  balance: number | null;
  lastReceived: number | null;
};

type SheetDraft = { amount: string; remarks: string };

function distinctSorted(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = (raw || "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function RecoveryForm({
  companyId,
  organizationId,
  parties,
  salesmen = [],
  onDone,
}: {
  companyId: string;
  organizationId: string;
  parties: Party[];
  salesmen?: SalesmanOption[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  const amountId = useId();
  const remarksId = useId();
  const amountRef = useRef<HTMLInputElement>(null);
  const remarksRef = useRef<HTMLInputElement>(null);

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [salesmanId, setSalesmanId] = useState("");
  const [city, setCity] = useState("");
  const [sector, setSector] = useState("");
  const [partyId, setPartyId] = useState("");
  const [party, setParty] = useState<Party | null>(null);
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [lines, setLines] = useState<RecoveryLine[]>([]);
  const [loading, setLoading] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [todayRecoveries, setTodayRecoveries] = useState<SameDayRecovery[]>([]);
  const [sheetRows, setSheetRows] = useState<SheetShop[]>([]);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetQuery, setSheetQuery] = useState("");
  const [sheetDrafts, setSheetDrafts] = useState<Record<string, SheetDraft>>({});

  const customers = useMemo(
    () =>
      parties.filter(
        (p) =>
          p.is_active !== false &&
          (p.party_subtype === "customer" || p.party_subtype === "both"),
      ),
    [parties],
  );
  const cityOptions = useMemo(
    () => distinctSorted(customers.map((p) => p.city)),
    [customers],
  );
  const sectorOptions = useMemo(() => {
    const list = city
      ? customers.filter((p) => (p.city || "").trim() === city)
      : customers;
    return distinctSorted(list.map((p) => p.route));
  }, [customers, city]);
  const visibleParties = useMemo(() => {
    return customers.filter((p) => {
      if (city && (p.city || "").trim() !== city) return false;
      if (sector && (p.route || "").trim() !== sector) return false;
      return true;
    });
  }, [customers, city, sector]);
  const locationFilterOn = Boolean(city || sector);

  function onCityChange(next: string) {
    setCity(next);
    if (!sector) return;
    const stillThere = customers.some(
      (p) =>
        (!next || (p.city || "").trim() === next) &&
        (p.route || "").trim() === sector,
    );
    if (!stillThere) setSector("");
    setSheetQuery("");
  }

  useEffect(() => {
    let cancelled = false;
    if (!locationFilterOn) {
      setSheetRows([]);
      setSheetLoading(false);
      return;
    }

    const base: SheetShop[] = visibleParties
      .map((p) => ({
        id: p.id,
        code: p.party_code,
        name: p.name_en,
        balance: null,
        lastReceived: null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    async function loadSheet() {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        if (!cancelled) setSheetRows(base);
        return;
      }
      setSheetLoading(true);
      try {
        const supabase = createClient();
        const { data: balances } = await supabase.rpc("get_recovery_sheet", {
          p_company_id: companyId,
          p_as_of: date,
          p_city: city || null,
          p_route: sector || null,
        });
        const balanceById = new Map<string, number>();
        for (const row of (balances || []) as Array<{
          party_id: string;
          balance: number | string;
        }>) {
          balanceById.set(row.party_id, Number(row.balance || 0));
        }

        const lastById = new Map<string, number>();
        const ids = base.map((row) => row.id);
        for (let i = 0; i < ids.length; i += 80) {
          const chunk = ids.slice(i, i + 80);
          const { data: recs } = await supabase
            .from("recoveries")
            .select("party_id, amount, recovery_date, created_at")
            .eq("company_id", companyId)
            .in("party_id", chunk)
            .gt("amount", 0)
            .lte("recovery_date", date)
            .order("recovery_date", { ascending: false })
            .order("created_at", { ascending: false });
          for (const row of recs || []) {
            const id = row.party_id as string;
            if (!id || lastById.has(id)) continue;
            lastById.set(id, Number(row.amount || 0));
          }
        }

        if (!cancelled) {
          setSheetRows(
            base.map((row) => ({
              ...row,
              balance: balanceById.has(row.id) ? balanceById.get(row.id)! : 0,
              lastReceived: lastById.get(row.id) ?? null,
            })),
          );
        }
      } catch {
        if (!cancelled) setSheetRows(base);
      } finally {
        if (!cancelled) setSheetLoading(false);
      }
    }

    void loadSheet();
    return () => {
      cancelled = true;
    };
  }, [companyId, date, city, sector, locationFilterOn, visibleParties]);

  useEffect(() => {
    let cancelled = false;
    async function loadBalance(id: string) {
      if (!id) {
        setBalance(null);
        return;
      }
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setBalance(null);
        return;
      }
      try {
        const supabase = createClient();
        const result = await Promise.race([
          supabase.rpc("get_party_balance", {
            p_company_id: companyId,
            p_party_id: id,
            p_as_of: date,
          }),
          new Promise<null>((r) => setTimeout(() => r(null), 3000)),
        ]);
        const data =
          result && typeof result === "object" && "data" in result
            ? (result as { data: unknown }).data
            : null;
        if (!cancelled) setBalance(data == null ? null : Number(data));
      } catch {
        if (!cancelled) setBalance(null);
      }
    }
    void loadBalance(partyId);
    return () => {
      cancelled = true;
    };
  }, [companyId, partyId, date]);

  useEffect(() => {
    let cancelled = false;
    if (!partyId) {
      setTodayRecoveries([]);
      return;
    }
    void findSameDayRecoveries(companyId, partyId, date).then((rows) => {
      if (!cancelled) setTodayRecoveries(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, partyId, date]);

  useEffect(() => {
    const t = requestAnimationFrame(() => focusCode());
    return () => cancelAnimationFrame(t);
  }, []);

  function focusCode() {
    requestAnimationFrame(() => {
      const code = document.querySelector<HTMLInputElement>(
        '[data-recovery-entry] input[placeholder="Code"]',
      );
      focusField(code);
    });
  }

  function clearDraft(focusCodeField = true) {
    setPartyId("");
    setParty(null);
    setAmount("");
    setRemarks("");
    setBalance(null);
    if (focusCodeField) focusCode();
  }

  function dueBlock(
    name: string,
    amt: number,
    owed: number | null,
    reserved: number,
  ) {
    if (owed == null) return null;
    const left = owed - reserved;
    if (left <= 0.005) {
      return `${name} has no amount due. The recovery was not added.`;
    }
    if (amt > left + 0.005) {
      return `${name} still owes ${formatPkr(left)}. A higher recovery was not added.`;
    }
    return null;
  }

  function recoveryWarning(
    name: string,
    prior: SameDayRecovery[],
    alreadyOnForm: boolean,
  ) {
    if (prior.length === 0 && !alreadyOnForm) return null;
    const listed = prior
      .map((row) => {
        const when = formatRecoveryWhen(row.at);
        return when ? `${formatPkr(row.amount)} at ${when}` : formatPkr(row.amount);
      })
      .join(", ");
    const text = alreadyOnForm
      ? `${name} is already on this recovery list.`
      : `${name} already has a recovery today${listed ? `: ${listed}` : ""}.`;
    return `${text}\n\nRecord this recovery anyway?`;
  }

  function commitLine() {
    setError(null);
    const amt = Number(amount);
    if (!partyId || !party || !(amt > 0)) {
      setError("Select customer and enter a recovery amount.");
      if (!partyId) focusCode();
      else focusField(amountRef.current);
      return false;
    }
    const reserved = lines
      .filter((line) => line.partyId === partyId)
      .reduce((sum, line) => sum + line.amount, 0);
    const blocked = dueBlock(party.name_en, amt, balance, reserved);
    if (blocked) {
      setError(blocked);
      focusField(amountRef.current);
      return false;
    }
    setLines((prev) => [
      ...prev,
      {
        key: newKey(),
        partyId,
        partyCode: party.party_code,
        partyName: party.name_en,
        amount: amt,
        remarks: remarks.trim(),
        owed: balance,
      },
    ]);
    clearDraft(true);
    return true;
  }

  function onAmountEnter(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    focusField(remarksRef.current);
  }

  function onRemarksEnter(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    commitLine();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setLoading(true);
    setError(null);
    try {
    await saveRecoveries();
    } finally {
      savingRef.current = false;
      setLoading(false);
    }
  }

  async function saveRecoveries() {
    setError(null);

    const fromSheet: RecoveryLine[] = sheetRows.flatMap((row) => {
      const draft = sheetDrafts[row.id];
      const sheetAmt = Number(draft?.amount);
      if (!(sheetAmt > 0)) return [];
      return [
        {
          key: `sheet-${row.id}`,
          partyId: row.id,
          partyCode: row.code,
          partyName: row.name,
          amount: sheetAmt,
          remarks: (draft?.remarks || "").trim(),
          owed: row.balance,
        },
      ];
    });

    let pending = [...lines, ...fromSheet];
    const amt = Number(amount);
    if (partyId && party && amt > 0) {
      pending = [
        ...pending,
        {
          key: newKey(),
          partyId,
          partyCode: party.party_code,
          partyName: party.name_en,
          amount: amt,
          remarks: remarks.trim(),
          owed: balance,
        },
      ];
      clearDraft(false);
    }
    if (fromSheet.length) {
      setSheetDrafts({});
    }
    pending = pending.map((line) =>
      line.requestId ? line : { ...line, requestId: crypto.randomUUID() },
    );
    setLines(pending);

    if (pending.length === 0) {
      setError("Add at least one recovery line before recording.");
      return;
    }

    const confirmedKeys = new Set<string>();
    for (let i = 0; i < pending.length; i += 1) {
      const line = pending[i];
      let owed = line.owed;
      if (owed == null && (typeof navigator === "undefined" || navigator.onLine)) {
        const supabase = createClient();
        const { data } = await supabase.rpc("get_party_balance", {
          p_company_id: companyId,
          p_party_id: line.partyId,
          p_as_of: date,
        });
        owed = data == null ? null : Number(data);
      }
      const reserved = pending
        .slice(0, i)
        .filter((row) => row.partyId === line.partyId)
        .reduce((sum, row) => sum + row.amount, 0);
      const blocked = dueBlock(line.partyName, line.amount, owed, reserved);
      if (blocked) {
        setError(blocked);
        return;
      }
      const prior = await findSameDayRecoveries(companyId, line.partyId, date);
      const warning = recoveryWarning(
        line.partyName,
        prior,
        pending.filter((row) => row.partyId === line.partyId).length > 1,
      );
      if (warning) {
        if (!window.confirm(warning)) return;
        confirmedKeys.add(line.key);
      }
    }

    const failedKeys = new Set<string>();
    const failedMsgs: string[] = [];

    for (const line of pending) {
      const lineParty = parties.find((p) => p.id === line.partyId);
      try {
        await offlineAwareSubmit({
          mutationType: "recovery",
          companyId,
          organizationId,
          payload: {
            organization_id: organizationId,
            company_id: companyId,
            party_id: line.partyId,
            recovery_date: date,
            amount: line.amount,
            remarks: line.remarks,
            salesman_id: salesmanId || null,
            route: lineParty?.route || null,
            city: lineParty?.city || null,
            client_request_id: line.requestId,
            confirm_duplicate: confirmedKeys.has(line.key),
          },
        });
      } catch (err: any) {
        failedKeys.add(line.key);
        failedMsgs.push(
          `${line.partyCode} — ${line.partyName}: ${err?.message || String(err)}`,
        );
      }
    }

    if (failedKeys.size) {
      setError(
        failedKeys.size === pending.length
          ? failedMsgs.join("\n")
          : `Saved ${pending.length - failedKeys.size} of ${pending.length}. Failed:\n${failedMsgs.join("\n")}`,
      );
      setLines(pending.filter((l) => failedKeys.has(l.key)));
      if (failedKeys.size < pending.length) router.refresh();
      return;
    }

    setLines([]);
    setSheetDrafts({});
    clearDraft(false);
    onDone?.();
    closeDialog?.();
    router.refresh();
  }

  const total = lines.reduce((s, l) => s + l.amount, 0);
  const draftAmt = Number(amount) > 0 ? Number(amount) : 0;
  const sheetExtras = sheetRows.reduce(
    (acc, row) => {
      const amt = Number(sheetDrafts[row.id]?.amount);
      if (!(amt > 0)) return acc;
      return { count: acc.count + 1, total: acc.total + amt };
    },
    { count: 0, total: 0 },
  );
  const pendingCount =
    lines.length + (draftAmt > 0 && partyId ? 1 : 0) + sheetExtras.count;
  const grand =
    total + (draftAmt > 0 && partyId ? draftAmt : 0) + sheetExtras.total;
  const sheetTerm = sheetQuery.trim().toLowerCase();
  const shownSheet = sheetTerm
    ? sheetRows.filter(
        (row) =>
          row.code.toLowerCase().includes(sheetTerm) ||
          row.name.toLowerCase().includes(sheetTerm),
      )
    : sheetRows;

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Date</Label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-1">
          <SalesmanSelect
            salesmen={salesmen}
            value={salesmanId}
            onChange={setSalesmanId}
          />
        </div>
        <div>
          <Label>City</Label>
          <Select value={city} onChange={(e) => onCityChange(e.target.value)}>
            <option value="">All cities</option>
            {cityOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Sector</Label>
          <Select
            value={sector}
            onChange={(e) => {
              setSector(e.target.value);
              setSheetQuery("");
            }}
          >
            <option value="">All sectors</option>
            {sectorOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="space-y-3" data-enter-own>
        <div className="table-grid">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr>
                <th className="w-[11rem]">Code</th>
                <th>Customer</th>
                <th className="w-28">Amount</th>
                <th>Remarks</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              <tr className="bg-[var(--brand-soft)]/25" data-recovery-entry>
                <td colSpan={2}>
                  <PartyCodePicker
                    companyId={companyId}
                    parties={parties}
                    value={partyId}
                    label=""
                    compact
                    filterSubtype={["customer", "both"]}
                    onChange={(id, next) => {
                      setPartyId(id);
                      setParty(next);
                    }}
                    onPartySelected={() => focusField(amountRef.current)}
                  />
                  {partyId && balance != null ? (
                    <p className="mt-1 text-[10px] text-[var(--muted)]">
                      Balance:{" "}
                      <span className="font-medium text-[var(--ink)]">
                        {formatPkr(Math.abs(balance))}{" "}
                        {balance > 0.005 ? "Dr" : balance < -0.005 ? "Cr" : "Nil"}
                      </span>
                    </p>
                  ) : null}
                  {partyId && balance != null && balance <= 0.005 ? (
                    <p className="mt-1 rounded-md bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700">
                      No amount due. A recovery cannot be added for this customer.
                    </p>
                  ) : null}
                  {todayRecoveries.length > 0 ? (
                    <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">
                      Already collected today:{" "}
                      {todayRecoveries
                        .map((row) => {
                          const when = formatRecoveryWhen(row.at);
                          return when
                            ? `${formatPkr(row.amount)} at ${when}`
                            : formatPkr(row.amount);
                        })
                        .join(", ")}
                    </p>
                  ) : null}
                </td>
                <td>
                  <Label htmlFor={amountId} className="sr-only">
                    Amount
                  </Label>
                  <Input
                    ref={amountRef}
                    id={amountId}
                    type="number"
                    min="0"
                    step={AMOUNT_STEP}
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onKeyDown={onAmountEnter}
                    placeholder={AMOUNT_PLACEHOLDER}
                  />
                </td>
                <td>
                  <Label htmlFor={remarksId} className="sr-only">
                    Remarks
                  </Label>
                  <Input
                    ref={remarksRef}
                    id={remarksId}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    onKeyDown={onRemarksEnter}
                    placeholder="Next / collected note"
                  />
                </td>
                <td>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="px-2"
                    onClick={() => commitLine()}
                    title="Add line (or press Enter on Remarks)"
                    data-enter-skip
                  >
                    Add
                  </Button>
                </td>
              </tr>

              {lines.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-6 text-center text-sm text-[var(--muted)]"
                  >
                    Added recoveries appear here. Keep using the top row to add
                    more.
                  </td>
                </tr>
              ) : (
                lines.map((line) => (
                  <tr key={line.key} className="border-t border-[var(--border)]">
                    <td className="font-medium tabular-nums">{line.partyCode}</td>
                    <td className="max-w-[16rem] truncate">{line.partyName}</td>
                    <td className="text-right font-semibold tabular-nums text-emerald-700">
                      {formatPkr(line.amount)}
                    </td>
                    <td className="max-w-[14rem] truncate text-[var(--muted)]">
                      {line.remarks || "—"}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-rose-50 hover:text-rose-700"
                        aria-label="Remove line"
                        data-enter-skip
                        onClick={() =>
                          setLines((prev) =>
                            prev.filter((l) => l.key !== line.key),
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm">
          <span className="text-[var(--muted)]">
            {lines.length} line{lines.length === 1 ? "" : "s"}
            {draftAmt > 0 && partyId ? " (+ draft)" : ""}
          </span>
          <span className="font-semibold">Total {formatPkr(grand)}</span>
        </div>

        {locationFilterOn ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">
                  {[sector || "All sectors", city || "All cities"].join(" · ")}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {sheetLoading
                    ? "Loading shops…"
                    : `${shownSheet.length} shop${shownSheet.length === 1 ? "" : "s"}`}
                  {sheetTerm && shownSheet.length !== sheetRows.length
                    ? ` of ${sheetRows.length}`
                    : ""}
                  . Type the amount on the row. The search above still finds every customer.
                </p>
              </div>
              <Input
                value={sheetQuery}
                onChange={(e) => setSheetQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
                placeholder="Search code or name..."
                className="w-full sm:w-56"
                data-enter-skip
              />
            </div>
            <div className="table-grid table-grid--y-scroll">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr>
                    <th className="w-24">Acc ID</th>
                    <th>Customer name</th>
                    <th className="w-28">Last received</th>
                    <th className="w-28">Final bal.</th>
                    <th className="w-28">Received</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {shownSheet.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-6 text-center text-sm text-[var(--muted)]"
                      >
                        No shops in this city and sector.
                      </td>
                    </tr>
                  ) : (
                    shownSheet.map((row) => {
                      const draft = sheetDrafts[row.id] || {
                        amount: "",
                        remarks: "",
                      };
                      const typed = Number(draft.amount);
                      const over =
                        row.balance != null &&
                        typed > 0 &&
                        (row.balance <= 0.005 || typed > row.balance + 0.005);
                      return (
                        <tr
                          key={row.id}
                          className="border-t border-[var(--border)]"
                        >
                          <td className="font-medium tabular-nums">{row.code}</td>
                          <td className="max-w-[16rem] truncate" title={row.name}>
                            {row.name}
                          </td>
                          <td className="tabular-nums text-[var(--muted)]">
                            {row.lastReceived != null && row.lastReceived > 0.005
                              ? formatNumber(row.lastReceived, 2)
                              : "-"}
                          </td>
                          <td
                            className={
                              row.balance == null
                                ? "text-[var(--muted)]"
                                : row.balance > 0.005
                                  ? "font-semibold tabular-nums text-rose-700"
                                  : row.balance < -0.005
                                    ? "font-semibold tabular-nums text-emerald-700"
                                    : "tabular-nums text-[var(--muted)]"
                            }
                          >
                            {row.balance == null
                              ? "…"
                              : Math.abs(row.balance) < 0.005
                                ? "Nil"
                                : row.balance > 0
                                  ? `${formatNumber(row.balance, 2)} Dr`
                                  : `${formatNumber(Math.abs(row.balance), 2)} Cr`}
                          </td>
                          <td>
                            <Input
                              type="number"
                              min="0"
                              step={AMOUNT_STEP}
                              inputMode="decimal"
                              value={draft.amount}
                              placeholder={AMOUNT_PLACEHOLDER}
                              className={over ? "border-rose-400" : undefined}
                              onChange={(e) =>
                                setSheetDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: {
                                    amount: e.target.value,
                                    remarks: prev[row.id]?.remarks || "",
                                  },
                                }))
                              }
                            />
                          </td>
                          <td>
                            <Input
                              value={draft.remarks}
                              placeholder="Collected note"
                              onChange={(e) =>
                                setSheetDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: {
                                    amount: prev[row.id]?.amount || "",
                                    remarks: e.target.value,
                                  },
                                }))
                              }
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-xs text-[var(--muted)]">
            Select a city and sector to list those shops here. Customer search
            above still finds every shop.
          </p>
        )}
      </div>

      {error ? (
        <p className="whitespace-pre-wrap rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <Button type="submit" loading={loading} className="w-full sm:w-auto">
        {loading
          ? "Recording..."
          : pendingCount > 0
            ? `Record ${pendingCount} recover${pendingCount === 1 ? "y" : "ies"}`
            : "Record recoveries"}
      </Button>
    </form>
  );
}
