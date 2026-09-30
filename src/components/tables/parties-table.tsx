"use client";

import { ChartCard } from "@/components/analytics/chart-card";
import { DonutChart, RankBars } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { PartyForm } from "@/components/forms/party-form";
import {
  stringOptions,
  TableFilterSelect,
} from "@/components/tables/table-filter-select";
import { TableScroll } from "@/components/tables/table-scroll";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { Button } from "@/components/ui/button";
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { useSearchInput, useUrlTableState } from "@/hooks/use-url-table-state";
import { fetchPartiesForExport, type PartyListStats } from "@/lib/queries/parties";
import { downloadPdf } from "@/lib/reports/export";
import { printWithAutoPaper } from "@/lib/print/paper-size";
import type { PaginationMeta } from "@/lib/pagination";
import type { Party, PartyType } from "@/lib/types/database";
import { amountClass, formatPkr } from "@/lib/utils";
import { deleteCachedRow, putCachedRow } from "@/lib/offline/local-db";
import { offlineAwareSubmit } from "@/lib/offline/offline-submit";
import { hasLocalSqlite, localUpsertMaster } from "@/lib/offline/sqlite-client";
import { createClient } from "@/lib/supabase/client";
import { Building2, FileText, Printer, Store, Truck, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

function partyTypeLabel(p: Party) {
  if (p.party_type !== "PARTY") return p.party_type;
  return p.party_subtype === "supplier" ? "vendor" : p.party_subtype;
}

function partyFields(p: Party): DetailField[] {
  return [
    { label: "Code", value: p.party_code },
    { label: "Name", value: p.name_en },
    { label: "Urdu name", value: p.name_ur || "—" },
    {
      label: "Type",
      value: p.party_type === "PARTY" ? "Customer" : p.party_type,
    },
    {
      label: "Subtype",
      value: p.party_subtype === "supplier" ? "vendor" : p.party_subtype,
    },
    { label: "Sale channel", value: p.sale_channel || "—" },
    { label: "City / Head", value: p.city || p.head || "—" },
    { label: "Sector", value: p.route || "—" },
    { label: "Address", value: p.address || "—" },
    { label: "Mobile", value: p.mobile || "—" },
    { label: "Phone", value: p.phone || "—" },
    { label: "Contact", value: p.contact_person || "—" },
    { label: "NTN", value: p.ntn || "—" },
    { label: "Opening balance", value: formatPkr(p.opening_balance) },
    { label: "Credit limit", value: formatPkr(p.credit_limit) },
    { label: "Status", value: p.is_active ? "Active" : "Inactive" },
  ];
}

type SubFilter = "all" | "customer" | "supplier" | "both" | "other" | "credit";

export function PartiesTable({
  parties,
  pagination,
  stats,
  companyId,
  companyName,
  organizationId,
  cityOptions = [],
  sectorOptions = [],
  initialType,
  canEdit = true,
  canInactivate = false,
  canDelete = false,
  onChanged,
}: {
  parties: Party[];
  pagination: PaginationMeta;
  stats: PartyListStats;
  companyId: string;
  companyName?: string;
  organizationId: string;
  cityOptions?: string[];
  sectorOptions?: string[];
  initialType?: string;
  canEdit?: boolean;
  canInactivate?: boolean;
  canDelete?: boolean;
  onChanged?: () => void;
}) {
  const { q, isPending, setPage, setPageSize, setQuery, setFilter, filters } =
    useUrlTableState(["type", "city", "sector"]);
  const search = useSearchInput(q, setQuery);
  const [exportBusy, setExportBusy] = useState<"pdf" | "print" | null>(null);
  const [printRows, setPrintRows] = useState<Record<string, unknown>[] | null>(
    null,
  );

  useEffect(() => {
    if (!printRows || exportBusy !== "print") return;
    const timer = window.setTimeout(() => {
      printWithAutoPaper("a4");
      setExportBusy(null);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [printRows, exportBusy]);

  const subtype = (filters.type ||
    (initialType === "customer" || initialType === "supplier"
      ? initialType
      : "all")) as SubFilter;

  function exportRow(p: Party) {
    return {
      Code: p.party_code,
      Name: p.name_en,
      "City / Head": p.city || p.head || "",
      Sector: p.route || "",
      Type: partyTypeLabel(p),
      "Shop number": p.mobile || "",
      "Owner number": p.phone || "",
      "Opening balance": Number(p.opening_balance || 0),
      "Credit limit": Number(p.credit_limit || 0),
      Status: p.is_active ? "Active" : "Inactive",
    };
  }

  async function loadExportRows() {
    const { isAppOnline } = await import("@/lib/offline/local-auth");
    const online = await isAppOnline();
    const view = stats.mode === "ledger" ? "ledger" : stats.mode === "trading" ? "trading" : "all";
    if (online) {
      const rows = await fetchPartiesForExport(createClient(), companyId, {
        q,
        type: subtype === "all" ? undefined : subtype,
        view: view === "all" ? undefined : view,
        city: filters.city,
        sector: filters.sector,
      });
      return rows.map(exportRow);
    }

    const { hasLocalSqlite, localListMaster } = await import(
      "@/lib/offline/sqlite-client"
    );
    const { getCachedRows } = await import("@/lib/offline/local-db");
    let cached: Party[] = [];
    if (hasLocalSqlite()) {
      const res = await localListMaster("parties", companyId);
      cached = (res.rows || []) as unknown as Party[];
    }
    if (!cached.length) {
      cached = (await getCachedRows("parties", companyId)) as unknown as Party[];
    }
    const search = q.trim().toLowerCase();
    const city = filters.city || "";
    const sector = filters.sector || "";
    return cached
      .filter((p) => {
        if (
          view === "ledger" &&
          !["ASSETS", "CAPITAL", "EXPENSES", "INCOME"].includes(p.party_type)
        ) {
          return false;
        }
        if (view === "trading" && p.party_type !== "PARTY") return false;
        if (subtype === "customer" && p.party_subtype !== "customer" && p.party_subtype !== "both") {
          return false;
        }
        if (subtype === "supplier" && p.party_subtype !== "supplier" && p.party_subtype !== "both") {
          return false;
        }
        if (subtype === "both" && p.party_subtype !== "both") return false;
        if (subtype === "other" && p.party_subtype !== "other") return false;
        if (subtype === "credit" && Number(p.credit_limit || 0) <= 0) return false;
        if (city && (p.city || p.head) !== city) return false;
        if (sector && p.route !== sector) return false;
        if (search) {
          const haystack = `${p.party_code || ""} ${p.name_en || ""} ${p.city || ""} ${p.route || ""} ${p.mobile || ""} ${p.phone || ""}`.toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      })
      .map(exportRow);
  }

  async function exportList(kind: "pdf" | "print") {
    setExportBusy(kind);
    try {
      const rows = await loadExportRows();
      if (kind === "pdf") {
        const title =
          stats.mode === "ledger"
            ? "Ledger heads"
            : subtype === "customer"
              ? "Customers / shops"
              : subtype === "supplier"
                ? "Vendors"
                : "Parties";
        await downloadPdf(rows, "customers-shops", companyName ? `${title} — ${companyName}` : title);
        setExportBusy(null);
        return;
      }
      setPrintRows(rows);
    } catch {
      setExportBusy(null);
    }
  }

  async function setActive(id: string, isActive: boolean) {
    const party = parties.find((p) => p.id === id);
    const payload = party
      ? { ...party, is_active: isActive }
      : { id, is_active: isActive, company_id: companyId };
    try {
      await offlineAwareSubmit({
        mutationType: "party_update",
        companyId,
        organizationId,
        cacheStore: "parties",
        cacheRecord: payload,
        payload,
      });
    } catch {
      if (hasLocalSqlite() && party) {
        await localUpsertMaster("parties", { ...party, is_active: isActive }).catch(() => {});
      }
      await putCachedRow("parties", companyId, payload).catch(() => {});
    }
  }

  async function remove(id: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("parties")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId);
    if (error) {
      if (error.code === "23503") {
        throw new Error(
          "This account is already on a bill, so it cannot be removed.",
        );
      }
      if (/organization admin/i.test(error.message)) {
        throw new Error("Only the organization admin can delete customers.");
      }
      throw new Error(error.message);
    }
    await deleteCachedRow("parties", id).catch(() => {});
    onChanged?.();
  }

  const isLedger = stats.mode === "ledger";
  const mixData = isLedger ? stats.ledgerMix : stats.subtypeMix;

  return (
    <div className="space-y-6">
      <StatsGrid>
        <StatCard
          label="In filter"
          value={stats.total}
          format="number"
          icon={Users}
          hint="Matches current search / chips"
        />
        {!isLedger ? (
          <>
            <button
              type="button"
              className="text-left"
              onClick={() => setFilter("type", "customer")}
            >
              <StatCard
                label="Customers / shops"
                value={stats.customers}
                format="number"
                icon={Store}
                tone={subtype === "customer" ? "brand" : "ok"}
                hint="Click to filter table"
              />
            </button>
            <button
              type="button"
              className="text-left"
              onClick={() => setFilter("type", "supplier")}
            >
              <StatCard
                label="Vendors"
                value={stats.suppliers}
                format="number"
                icon={Truck}
                tone={subtype === "supplier" ? "brand" : "neutral"}
                hint="Click to filter table"
              />
            </button>
            <button
              type="button"
              className="text-left"
              onClick={() => setFilter("type", "credit")}
            >
              <StatCard
                label="With credit limit"
                value={stats.withCreditLimit}
                format="number"
                icon={Building2}
                tone={subtype === "credit" ? "brand" : "warn"}
                hint="Click to filter table"
              />
            </button>
          </>
        ) : (
          (["ASSETS", "CAPITAL", "EXPENSES", "INCOME"] as PartyType[]).map(
            (ledgerType) => {
              const count =
                stats.ledgerMix.find(
                  (row) => row.name.toUpperCase() === ledgerType,
                )?.value ?? 0;
              return (
                <StatCard
                  key={ledgerType}
                  label={ledgerType.charAt(0) + ledgerType.slice(1).toLowerCase()}
                  value={count}
                  format="number"
                  icon={Building2}
                  tone="brand"
                  hint="Ledger head count"
                />
              );
            },
          )
        )}
      </StatsGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title={isLedger ? "Ledger type mix" : "Customer / vendor mix"}
          subtitle="Based on current filter"
        >
          <DonutChart
            data={mixData}
            centerValue={String(stats.total)}
            centerLabel="Filtered"
          />
        </ChartCard>
        {!isLedger ? (
          <ChartCard
            className="lg:col-span-2"
            title="Accounts by city"
            subtitle="Updates with search & filters"
          >
            <RankBars data={stats.cityBars} money={false} />
          </ChartCard>
        ) : null}
      </div>

      <div>
        <TableToolbar
          query={search.query}
          onQueryChange={search.onQueryChange}
          onFocus={search.onFocus}
          onBlur={search.onBlur}
          placeholder="Search code, name, city / head, sector, phone..."
          resultCount={pagination.total}
          totalCount={pagination.total}
          filters={
            <div className="flex flex-wrap items-center gap-2">
              {cityOptions.length ? (
                <TableFilterSelect
                  label="City / Head"
                  value={filters.city || ""}
                  options={stringOptions(cityOptions)}
                  loading={isPending}
                  onChange={(value) => setFilter("city", value)}
                />
              ) : null}
              {sectorOptions.length ? (
                <TableFilterSelect
                  label="Sector"
                  value={filters.sector || ""}
                  options={stringOptions(sectorOptions)}
                  loading={isPending}
                  onChange={(value) => setFilter("sector", value)}
                />
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={exportBusy === "pdf"}
                disabled={exportBusy !== null}
                onClick={() => void exportList("pdf")}
              >
                <FileText className="h-4 w-4" />
                PDF
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={exportBusy === "print"}
                disabled={exportBusy !== null}
                onClick={() => void exportList("print")}
              >
                <Printer className="h-4 w-4" />
                Print
              </Button>
            </div>
          }
        />

        <div className="table-shell">
          <TableScroll loading={isPending}>
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>City / Head · Sector</th>
                  <th>{isLedger ? "Ledger type" : "Type"}</th>
                  <th>Op. Balance</th>
                  {!isLedger ? <th>Credit Limit</th> : null}
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {parties.length ? (
                  parties.map((p) => (
                    <tr key={p.id} className={!p.is_active ? "opacity-60" : undefined}>
                      <td className="font-medium">{p.party_code}</td>
                      <td>
                        <Link
                          href={`/parties/insights/${p.id}`}
                          className="font-medium text-[var(--brand)] hover:underline"
                        >
                          {p.name_en}
                        </Link>
                        {!p.is_active ? (
                          <span className="ml-2 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--muted)]">
                            Inactive
                          </span>
                        ) : null}
                        {p.name_ur ? (
                          <div className="text-xs text-[var(--muted)]" dir="rtl">
                            {p.name_ur}
                          </div>
                        ) : null}
                      </td>
                      <td className="text-[var(--muted)]">
                        {[p.city || p.head, p.route].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td>
                        <span className="rounded-full bg-[var(--surface-2)] px-2 py-1 text-xs font-semibold uppercase">
                          {partyTypeLabel(p)}
                        </span>
                      </td>
                      <td className={amountClass}>{formatPkr(p.opening_balance)}</td>
                      {!isLedger ? (
                        <td className={amountClass}>{formatPkr(p.credit_limit)}</td>
                      ) : null}
                      <td>
                        <RowActions
                          viewTitle={p.name_en}
                          editTitle={`Edit ${p.name_en}`}
                          deleteTitle={
                            canDelete
                              ? `Delete ${p.name_en}?`
                              : `Mark ${p.name_en} inactive?`
                          }
                          deleteDescription={
                            canDelete
                              ? "This removes the account. An account already used on a bill cannot be removed."
                              : "The account stays on old documents and is hidden from new transactions. This does not delete it."
                          }
                          viewFields={partyFields(p)}
                          allowEdit={canEdit}
                          allowDelete={
                            canDelete || (canInactivate && p.is_active)
                          }
                          onDelete={() =>
                            canDelete ? remove(p.id) : setActive(p.id, false)
                          }
                          editContent={(close) => (
                            <PartyForm
                              companyId={companyId}
                              organizationId={organizationId}
                              cityOptions={cityOptions}
                              sectorOptions={sectorOptions}
                              initial={p}
                              onDone={close}
                            />
                          )}
                        />
                        {!p.is_active && canInactivate ? (
                          <button
                            type="button"
                            className="ml-1 text-xs font-medium text-[var(--brand-strong)]"
                            onClick={() => void setActive(p.id, true)}
                          >
                            Restore
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={isLedger ? 6 : 7}
                      className="py-8 text-center text-[var(--muted)]"
                    >
                      No parties match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScroll>
          <TablePagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            total={pagination.total}
            from={pagination.from}
            to={pagination.to}
            loading={isPending}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      </div>

      {printRows ? (
        <div
          className="print-only print-sheet report-print"
          data-paper="a4"
          data-print-id="customers-shops"
        >
          <div className="report-print-head">
            <div>
              <p className="report-print-title">
                {stats.mode === "ledger"
                  ? "Ledger heads"
                  : subtype === "customer"
                    ? "Customers / shops"
                    : subtype === "supplier"
                      ? "Vendors"
                      : "Parties"}
              </p>
              {companyName ? <p className="report-print-co">{companyName}</p> : null}
            </div>
            <p className="report-print-meta">{printRows.length} rows</p>
          </div>
          {printRows.length ? (
            <table>
              <thead>
                <tr>
                  {Object.keys(printRows[0]).map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {printRows.map((row, index) => (
                  <tr key={index}>
                    {Object.entries(row).map(([column, value]) => (
                      <td key={column}>
                        {typeof value === "number" ? formatPkr(value) : String(value || "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No customers match this filter.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
