import { ChartCard } from "@/components/analytics/chart-card";
import { DonutChart, RankBars } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { AccountsSectorFilter } from "@/components/reports/accounts-sector-filter";
import { ReportTable } from "@/components/reports/report-table";
import { ReportFilterActions } from "@/components/reports/report-filters";
import { UrlFilterForm } from "@/components/reports/url-filter-form";
import { Select } from "@/components/ui/select";
import { requireCompanyContext } from "@/lib/auth";
import { effectivePermissions } from "@/lib/access/permissions";
import { localDateIso } from "@/lib/dates";
import { LIST_STATS_COOKIE, rememberStats } from "@/lib/list-stats-revision";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
import { cookies } from "next/headers";
import { formatCompactPkr, formatPkr} from "@/lib/utils";
import { ArrowDownLeft, ArrowUpRight, Scale } from "lucide-react";
import Link from "next/link";

function distinctSectors(values: Array<string | null | undefined>) {
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

type BalanceRow = {
  party_id: string;
  party_code: string;
  name_en: string;
  city: string | null;
  route: string | null;
  balance: number;
  credit_limit: number;
};

function signedText(balance: number) {
  if (Math.abs(balance) < 0.005) return "Nil";
  if (balance > 0) return `${formatPkr(balance)} Dr`;
  return `${formatPkr(Math.abs(balance))} Cr`;
}

const LEDGER_DOC_TABLES = new Set([
  "sale_invoices",
  "purchase_invoices",
  "sale_returns",
  "purchase_returns",
  "vouchers",
]);

function editableLedgerDoc(table: string | null, id: string | null) {
  return Boolean(table && id && LEDGER_DOC_TABLES.has(table));
}

function ledgerDocHref(table: string, id: string) {
  if (table === "sale_invoices") return `/sales/invoices/${id}`;
  if (table === "purchase_invoices") return `/purchases/invoices/${id}`;
  if (table === "sale_returns") return `/sales/returns/${id}`;
  if (table === "purchase_returns") return `/purchases/returns/${id}`;
  return "";
}

export default async function AccountsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; party?: string; sector?: string }>;
}) {
  const sp = await searchParams;
  const { supabase, company, offline, membership, profile } =
    await requireCompanyContext();
  const permissions = effectivePermissions(
    membership,
    Boolean(profile?.is_super_admin),
  );
  const canEditParty = permissions.includes("edit_customers");
  const canInactivate = permissions.includes("inactivate_records");
  const view = sp.view || "receivable";
  const sector = (sp.sector || "").trim();

  if (offline) {
    const { OfflineAccountsReportsPage } = await import(
      "@/components/offline/offline-accounts-reports"
    );
    return (
      <OfflineAccountsReportsPage
        companyId={company.id}
        companyName={company.name}
        organizationId={company.organization_id}
        canEditParty={canEditParty}
        canInactivate={canInactivate}
        searchParams={sp}
      />
    );
  }

  const { data: sheet } = await supabase.rpc("get_recovery_sheet", {
    p_company_id: company.id,
    p_as_of: localDateIso(),
    p_city: null,
    p_route: null,
  });

  const all = (sheet || []) as BalanceRow[];
  const sectorOptions = distinctSectors(all.map((r) => r.route));
  const filtered = all.filter((r) => {
    if (sector && (r.route || "").trim() !== sector) return false;
    const bal = Number(r.balance);
    if (view === "receivable") return bal > 0.005;
    if (view === "payable") return bal < -0.005;
    if (view === "all") return true;
    return true;
  });

  const statsRevision = (await cookies()).get(LIST_STATS_COOKIE)?.value || "";
  const parties = await rememberStats(
    `account-parties:${company.id}:${statsRevision}`,
    () =>
      fetchAllPages<{
        id: string;
        party_code: string;
        name_en: string;
        party_subtype: string | null;
        route: string | null;
      }>((from, to) =>
        supabase
          .from("parties")
          .select("id, party_code, name_en, party_subtype, route")
          .eq("company_id", company.id)
          .eq("is_active", true)
          .order("name_en", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      ),
  ).catch(() => [] as Array<{
    id: string;
    party_code: string;
    name_en: string;
    party_subtype: string | null;
    route: string | null;
  }>);

  const ledgerParties = (parties || []).filter((p) => {
    if (!sector) return true;
    return (p.route || "").trim() === sector;
  });
  const sectorQs = sector ? `&sector=${encodeURIComponent(sector)}` : "";

  let ledgerRows: Record<string, unknown>[] = [];
  let linkedCompanyNames: string[] = [];
  const selectedParty = (parties || []).find(
    (p) =>
      p.id === sp.party &&
      (!sector || (p.route || "").trim() === sector),
  );

  if (view === "ledger" && selectedParty) {
    const partyId = selectedParty.id;
    const [{ data: opening }, { data: ledger }, { data: partyRecoveries }, { data: linkedWh }] =
      await Promise.all([
        supabase
          .from("parties")
          .select("opening_balance")
          .eq("id", partyId)
          .maybeSingle(),
        supabase
          .from("ledger_entries")
          .select("entry_date, debit, credit, narration, voucher_type, ref_table, ref_id")
          .eq("company_id", company.id)
          .eq("party_id", partyId)
          .order("entry_date", { ascending: true })
          .order("created_at", { ascending: true })
          .limit(500),
        supabase
          .from("recoveries")
          .select("id, voucher_id")
          .eq("company_id", company.id)
          .eq("party_id", partyId)
          .order("recovery_date", { ascending: false })
          .limit(500),
        supabase
          .from("warehouses")
          .select("id, name")
          .eq("company_id", company.id)
          .eq("is_active", true)
          .eq("default_supplier_id", partyId)
          .order("name"),
      ]);

    linkedCompanyNames = (linkedWh || []).map((w) => w.name || "Company");
    const showCompany =
      linkedCompanyNames.length > 0 ||
      selectedParty?.party_subtype === "supplier" ||
      selectedParty?.party_subtype === "both";

    const saleIds = (ledger || [])
      .filter((e) => e.ref_table === "sale_invoices" && e.ref_id)
      .map((e) => String(e.ref_id));
    const purchaseIds = (ledger || [])
      .filter((e) => e.ref_table === "purchase_invoices" && e.ref_id)
      .map((e) => String(e.ref_id));
    const saleReturnIds = (ledger || [])
      .filter((e) => e.ref_table === "sale_returns" && e.ref_id)
      .map((e) => String(e.ref_id));
    const returnIds = (ledger || [])
      .filter((e) => e.ref_table === "purchase_returns" && e.ref_id)
      .map((e) => String(e.ref_id));
    const voucherIds = (ledger || [])
      .filter((e) => e.ref_table === "vouchers" && e.ref_id)
      .map((e) => String(e.ref_id));

    const [saleDocs, purchaseDocs, saleReturnDocs, returnDocs, voucherDocs] =
      await Promise.all([
        saleIds.length
          ? supabase
              .from("sale_invoices")
              .select("id, status")
              .in("id", saleIds)
          : Promise.resolve({ data: [] as { id: string; status: string }[] }),
        purchaseIds.length
          ? supabase
              .from("purchase_invoices")
              .select("id, status, warehouses(name)")
              .in("id", purchaseIds)
          : Promise.resolve({
              data: [] as {
                id: string;
                status: string;
                warehouses: { name?: string } | { name?: string }[] | null;
              }[],
            }),
        saleReturnIds.length
          ? supabase
              .from("sale_returns")
              .select("id, status")
              .in("id", saleReturnIds)
          : Promise.resolve({ data: [] as { id: string; status: string }[] }),
        returnIds.length
          ? supabase
              .from("purchase_returns")
              .select("id, status, warehouses(name)")
              .in("id", returnIds)
          : Promise.resolve({
              data: [] as {
                id: string;
                status: string;
                warehouses: { name?: string } | { name?: string }[] | null;
              }[],
            }),
        voucherIds.length
          ? supabase
              .from("vouchers")
              .select("id, warehouses(name)")
              .in("id", voucherIds)
          : Promise.resolve({
              data: [] as {
                id: string;
                warehouses: { name?: string } | { name?: string }[] | null;
              }[],
            }),
      ]);

    const cancelledLedgerRefs = new Set<string>();
    const markCancelled = (
      table: string,
      rows: Array<{ id: string; status?: string | null }> | null,
    ) => {
      for (const row of rows || []) {
        const status = String(row.status || "").toLowerCase();
        if (status === "cancelled" || status === "void" || status === "voided") {
          cancelledLedgerRefs.add(`${table}:${row.id}`);
        }
      }
    };
    markCancelled("sale_invoices", saleDocs.data);
    markCancelled("purchase_invoices", purchaseDocs.data);
    markCancelled("sale_returns", saleReturnDocs.data);
    markCancelled("purchase_returns", returnDocs.data);

    const visibleLedger = (ledger || []).filter((e) => {
      if (!e.ref_table || !e.ref_id) return true;
      const key = `${e.ref_table}:${e.ref_id}`;
      return !cancelledLedgerRefs.has(key);
    });

    const companyByRef = new Map<string, string>();
    const remember = (
      rows: Array<{ id: string; warehouses: { name?: string } | { name?: string }[] | null }> | null,
    ) => {
      for (const row of rows || []) {
        const wh = Array.isArray(row.warehouses) ? row.warehouses[0] : row.warehouses;
        if (wh?.name) companyByRef.set(String(row.id), wh.name);
      }
    };
    remember(purchaseDocs.data);
    remember(returnDocs.data);
    remember(voucherDocs.data);

    const recoveryByRef = new Map<string, string>();
    for (const rec of partyRecoveries || []) {
      const id = String(rec.id);
      recoveryByRef.set(id, id);
      if (rec.voucher_id) recoveryByRef.set(String(rec.voucher_id), id);
    }

    const partyLabel = selectedParty
      ? `${selectedParty.party_code} — ${selectedParty.name_en}`
      : "Customer";

    let running = Number(opening?.opening_balance || 0);
    ledgerRows = [
      {
        Date: "",
        Type: "OP",
        ...(showCompany ? { Company: "—" } : {}),
        Narration: "Opening balance",
        Debit: running > 0 ? running : 0,
        Credit: running < 0 ? Math.abs(running) : 0,
        Balance: signedText(running),
      },
      ...visibleLedger.map((e) => {
        running += Number(e.debit) - Number(e.credit);
        const recoveryId =
          e.ref_id && (e.voucher_type === "CR" || e.narration === "Recovery")
            ? recoveryByRef.get(String(e.ref_id)) || ""
            : "";
        return {
          Date: e.entry_date,
          Type: e.voucher_type || "—",
          ...(showCompany
            ? {
                Company: e.ref_id
                  ? companyByRef.get(String(e.ref_id)) || "—"
                  : "—",
              }
            : {}),
          Narration: e.narration || "—",
          Debit: Number(e.debit),
          Credit: Number(e.credit),
          Balance: signedText(running),
          ...(recoveryId
            ? {
                _doc_table: "recoveries",
                _doc_id: recoveryId,
                _doc_title: e.narration || "Recovery",
                _party_id: partyId,
                _party_label: partyLabel,
                _company_id: company.id,
              }
            : editableLedgerDoc(e.ref_table, e.ref_id)
              ? {
                  _doc_table: e.ref_table,
                  _doc_id: String(e.ref_id),
                  _doc_title: e.narration || String(e.voucher_type || "Document"),
                  _href: ledgerDocHref(String(e.ref_table), String(e.ref_id)),
                }
              : {}),
        };
      }),
    ];
  }

  const receivableTotal = all
    .filter((r) => Number(r.balance) > 0.005)
    .reduce((s, r) => s + Number(r.balance), 0);
  const payableTotal = all
    .filter((r) => Number(r.balance) < -0.005)
    .reduce((s, r) => s + Math.abs(Number(r.balance)), 0);
  const net = receivableTotal - payableTotal;
  const topRecv = all
    .filter((r) => Number(r.balance) > 0.005)
    .sort((a, b) => Number(b.balance) - Number(a.balance))
    .slice(0, 6)
    .map((r) => ({
      name: `${r.party_code} ${r.name_en}`,
      value: Number(r.balance),
    }));
  const positionMix = [
    { name: "Receivable", value: receivableTotal },
    { name: "Payable", value: payableTotal },
  ].filter((x) => x.value > 0);

  const balanceRows = filtered.map((r) => ({
    Code: r.party_code,
    Name: r.name_en,
    City: r.city || "",
    Sector: r.route || "",
    Balance: signedText(Number(r.balance)),
    "Balance value": Number(r.balance),
    "Credit limit": Number(r.credit_limit || 0),
    Flag:
      Number(r.credit_limit) > 0 && Number(r.balance) > Number(r.credit_limit)
        ? "Over limit"
        : "",
    ...(canEditParty || canInactivate
      ? {
          _party_manage: "1",
          _party_id: r.party_id,
          _party_label: `${r.party_code} — ${r.name_en}`,
          _company_id: company.id,
          _organization_id: company.organization_id,
          _can_edit_party: canEditParty ? "1" : "0",
          _can_inactivate: canInactivate ? "1" : "0",
        }
      : {}),
  }));

  return (
    <div className="animate-rise space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          Accounts Reports
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Receivables, payables, and customer ledger — export ready
        </p>
      </div>

      <div className="no-print flex flex-wrap gap-2">
        {[
          ["receivable", "Receivable (Debit)"],
          ["payable", "Payable (Credit)"],
          ["all", "All balances"],
          ["ledger", "Customer ledger"],
          ["salesman", "Salesman ledger"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={
              key === "ledger"
                ? `/reports/accounts?view=ledger${sp.party ? `&party=${sp.party}` : ""}${sectorQs}`
                : key === "salesman"
                  ? "/reports/salesman-ledger"
                  : `/reports/accounts?view=${key}${sectorQs}`
            }
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              view === key
                ? "bg-[var(--brand)] !text-white"
                : "border border-[var(--border)] bg-white text-[var(--muted)]"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <StatsGrid>
        <StatCard
          label="Receivable"
          value={receivableTotal}
          format="money"
          icon={ArrowUpRight}
          tone="warn"
          href="/reports/accounts?view=receivable"
          hint="Customers owe this to you"
        />
        <StatCard
          label="Payable"
          value={payableTotal}
          format="money"
          icon={ArrowDownLeft}
          href="/reports/accounts?view=payable"
          hint="You owe this to vendors"
        />
        <StatCard
          label="Net position"
          value={net}
          format="money"
          icon={Scale}
          tone={net >= 0 ? "ok" : "danger"}
          hint={net >= 0 ? "Net positive working capital" : "Payables outweigh receivables"}
        />
        <StatCard
          label="Accounts in view"
          value={balanceRows.length}
          format="number"
          tone="neutral"
          hint="Rows matching current filter"
        />
      </StatsGrid>

      {view !== "ledger" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <ChartCard title="AR vs AP" subtitle="Money in vs money out">
            <DonutChart
              data={positionMix}
              centerValue={formatCompactPkr(Math.abs(net))}
              centerLabel="Net"
            />
          </ChartCard>
          <ChartCard
            className="lg:col-span-2"
            title="Top receivables"
            subtitle="Largest shop dues"
          >
            <RankBars data={topRecv} />
          </ChartCard>
        </div>
      ) : null}

      {view === "ledger" ? (
        <div className="space-y-4">
          <UrlFilterForm className="panel no-print flex flex-wrap items-end gap-3 p-4">
            <AccountsSectorFilter
              options={sectorOptions.length ? sectorOptions : distinctSectors((parties || []).map((p) => p.route))}
              keepKeys={["view"]}
              clearPartyOnChange
            />
            <div className="min-w-[200px] flex-1 basis-[16rem] sm:max-w-md">
              <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
                Customer / vendor
              </label>
              <Select
                name="party"
                defaultValue={
                  sp.party && ledgerParties.some((p) => p.id === sp.party)
                    ? sp.party
                    : ""
                }
                options={[
                  { value: "", label: "Select customer / vendor" },
                  ...ledgerParties.map((p) => ({
                    value: p.id,
                    label: `${p.party_code} — ${p.name_en}`,
                  })),
                ]}
              />
            </div>
            <input type="hidden" name="view" value="ledger" />
            {sector ? <input type="hidden" name="sector" value={sector} /> : null}
            <ReportFilterActions
              submitLabel="Load ledger"
              nowrap
              keepKeys={["view", "sector"]}
              className="shrink-0"
            />
          </UrlFilterForm>

          <ReportTable
            title={`Customer ledger — ${selectedParty ? `${selectedParty.party_code} ${selectedParty.name_en}` : company.name}`}
            companyName={company.name}
            subtitle={
              selectedParty
                ? `${ledgerRows.length} lines · closing = total debit − total credit${
                    linkedCompanyNames.length
                      ? ` · Companies: ${linkedCompanyNames.join(", ")}`
                      : ""
                  }${sector ? ` · Sector: ${sector}` : ""}`
                : sector
                  ? `Select a customer / vendor in ${sector}`
                  : "Select a customer / vendor"
            }
            rows={selectedParty ? ledgerRows : []}
            filename={`party-ledger-${sp.party || "none"}`}
          />
        </div>
      ) : (
        <ReportTable
          title={`${view} balances`}
          companyName={company.name}
          subtitle={`${balanceRows.length} parties${sector ? ` · Sector: ${sector}` : ""}`}
          rows={balanceRows}
          filename={`accounts-${view}`}
          filters={
            <AccountsSectorFilter
              options={sectorOptions}
              keepKeys={["view"]}
              compact
            />
          }
        />
      )}
    </div>
  );
}
