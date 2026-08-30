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
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { useUrlTableState } from "@/hooks/use-url-table-state";
import type { PartyListStats } from "@/lib/queries/parties";
import { createClient } from "@/lib/supabase/client";
import type { PaginationMeta } from "@/lib/pagination";
import type { Party, PartyType } from "@/lib/types/database";
import { amountClass, formatPkr } from "@/lib/utils";
import { Building2, Store, Truck, Users } from "lucide-react";
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
  organizationId,
  cityOptions = [],
  sectorOptions = [],
  initialType,
}: {
  parties: Party[];
  pagination: PaginationMeta;
  stats: PartyListStats;
  companyId: string;
  organizationId: string;
  cityOptions?: string[];
  sectorOptions?: string[];
  initialType?: string;
}) {
  const { q, isPending, setPage, setPageSize, setQuery, setFilter, filters } =
    useUrlTableState(["type", "city", "sector"]);
  const [localQuery, setLocalQuery] = useState(q);

  const subtype = (filters.type ||
    (initialType === "customer" || initialType === "supplier"
      ? initialType
      : "all")) as SubFilter;

  useEffect(() => {
    setLocalQuery(q);
  }, [q]);

  async function deactivate(id: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("parties")
      .update({ is_active: false })
      .eq("id", id);
    if (error) throw new Error(error.message);
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
          query={localQuery}
          onQueryChange={(value) => {
            setLocalQuery(value);
            setQuery(value);
          }}
          loading={isPending}
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
                    <tr key={p.id}>
                      <td className="font-medium">{p.party_code}</td>
                      <td>
                        <Link
                          href={`/parties/insights/${p.id}`}
                          className="font-medium text-[var(--brand)] hover:underline"
                        >
                          {p.name_en}
                        </Link>
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
                          deleteTitle={`Remove ${p.name_en}?`}
                          deleteDescription="This account will be removed from this list and hidden from new transactions."
                          viewFields={partyFields(p)}
                          onDelete={() => deactivate(p.id)}
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
    </div>
  );
}
