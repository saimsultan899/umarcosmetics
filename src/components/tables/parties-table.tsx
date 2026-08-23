"use client";

import { ChartCard } from "@/components/analytics/chart-card";
import { DonutChart, RankBars } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { PartyForm } from "@/components/forms/party-form";
import { FilterChip } from "@/components/tables/filter-chip";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { useClientPagination } from "@/hooks/use-client-pagination";
import { createClient } from "@/lib/supabase/client";
import type { Party } from "@/lib/types/database";
import { formatPkr } from "@/lib/utils";
import { Building2, Store, Truck, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

function partyFields(p: Party): DetailField[] {
  return [
    { label: "Code", value: p.party_code },
    { label: "Name", value: p.name_en },
    { label: "Urdu name", value: p.name_ur || "—" },
    { label: "Type", value: p.party_type },
    { label: "Subtype", value: p.party_subtype },
    { label: "Sale channel", value: p.sale_channel || "—" },
    { label: "City", value: p.city || "—" },
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
  companyId,
  organizationId,
  initialType,
}: {
  parties: Party[];
  companyId: string;
  organizationId: string;
  initialType?: string;
}) {
  const [query, setQuery] = useState("");
  const [subtype, setSubtype] = useState<SubFilter>(
    initialType === "customer" || initialType === "supplier"
      ? initialType
      : "all",
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return parties.filter((p) => {
      if (subtype === "credit" && !(Number(p.credit_limit) > 0)) return false;
      if (
        subtype !== "all" &&
        subtype !== "credit" &&
        p.party_subtype !== subtype &&
        !(subtype === "customer" && p.party_subtype === "both") &&
        !(subtype === "supplier" && p.party_subtype === "both")
      ) {
        return false;
      }
      if (!q) return true;
      return [
        p.party_code,
        p.name_en,
        p.name_ur,
        p.city,
        p.route,
        p.mobile,
        p.phone,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [parties, query, subtype]);

  const pager = useClientPagination(filtered);

  const customers = filtered.filter(
    (p) => p.party_subtype === "customer" || p.party_subtype === "both",
  ).length;
  const suppliers = filtered.filter(
    (p) => p.party_subtype === "supplier" || p.party_subtype === "both",
  ).length;
  const withLimit = filtered.filter((p) => Number(p.credit_limit) > 0).length;

  const cities = new Map<string, number>();
  for (const p of filtered) {
    const key = p.city || "No city";
    cities.set(key, (cities.get(key) || 0) + 1);
  }
  const cityBars = [...cities.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const subtypeMix = [
    {
      name: "Customers",
      value: filtered.filter((p) => p.party_subtype === "customer").length,
    },
    {
      name: "Suppliers",
      value: filtered.filter((p) => p.party_subtype === "supplier").length,
    },
    {
      name: "Both",
      value: filtered.filter((p) => p.party_subtype === "both").length,
    },
    {
      name: "Other",
      value: filtered.filter((p) => p.party_subtype === "other").length,
    },
  ].filter((x) => x.value > 0);

  async function deactivate(id: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("parties")
      .update({ is_active: false })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }

  return (
    <div className="space-y-6">
      <StatsGrid>
        <StatCard
          label="In filter"
          value={filtered.length}
          format="number"
          icon={Users}
          hint="Matches current search / chips"
        />
        <button type="button" className="text-left" onClick={() => setSubtype("customer")}>
          <StatCard
            label="Customers / shops"
            value={customers}
            format="number"
            icon={Store}
            tone={subtype === "customer" ? "brand" : "ok"}
            hint="Click to filter table"
          />
        </button>
        <button type="button" className="text-left" onClick={() => setSubtype("supplier")}>
          <StatCard
            label="Suppliers"
            value={suppliers}
            format="number"
            icon={Truck}
            tone={subtype === "supplier" ? "brand" : "neutral"}
            hint="Click to filter table"
          />
        </button>
        <button type="button" className="text-left" onClick={() => setSubtype("credit")}>
          <StatCard
            label="With credit limit"
            value={withLimit}
            format="number"
            icon={Building2}
            tone={subtype === "credit" ? "brand" : "warn"}
            hint="Click to filter table"
          />
        </button>
      </StatsGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Party mix" subtitle="Based on current filter">
          <DonutChart
            data={subtypeMix}
            centerValue={String(filtered.length)}
            centerLabel="Filtered"
          />
        </ChartCard>
        <ChartCard
          className="lg:col-span-2"
          title="Parties by city"
          subtitle="Updates with search & chips"
        >
          <RankBars data={cityBars} money={false} />
        </ChartCard>
      </div>

      <div>
        <TableToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="Search code, name, city, sector, phone..."
          resultCount={filtered.length}
          totalCount={parties.length}
          filters={
            <>
              {(
                [
                  ["all", "All"],
                  ["customer", "Customers"],
                  ["supplier", "Suppliers"],
                  ["both", "Both"],
                  ["credit", "Credit limit"],
                ] as const
              ).map(([key, label]) => (
                <FilterChip
                  key={key}
                  active={subtype === key}
                  onClick={() => setSubtype(key)}
                >
                  {label}
                </FilterChip>
              ))}
            </>
          }
        />

        <div className="table-shell">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>City / Sector</th>
                  <th>Type</th>
                  <th>Op. Balance</th>
                  <th>Credit Limit</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.slice.length ? (
                  pager.slice.map((p) => (
                    <tr
                      key={p.id}
                      className={!p.is_active ? "opacity-50" : undefined}
                    >
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
                        {[p.city, p.route].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td>
                        <span className="rounded-full bg-[var(--surface-2)] px-2 py-1 text-xs font-semibold uppercase">
                          {p.party_subtype}
                        </span>
                      </td>
                      <td>{formatPkr(p.opening_balance)}</td>
                      <td>{formatPkr(p.credit_limit)}</td>
                      <td>
                        <RowActions
                          viewTitle={p.name_en}
                          editTitle={`Edit ${p.name_en}`}
                          deleteTitle={`Deactivate ${p.name_en}?`}
                          deleteDescription="Party will be marked inactive and hidden from new transactions."
                          viewFields={partyFields(p)}
                          onDelete={() => deactivate(p.id)}
                          editContent={(close) => (
                            <PartyForm
                              companyId={companyId}
                              organizationId={organizationId}
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
                      colSpan={7}
                      className="py-8 text-center text-[var(--muted)]"
                    >
                      No parties match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={pager.page}
            totalPages={pager.totalPages}
            pageSize={pager.pageSize}
            total={pager.total}
            from={pager.from}
            to={pager.to}
            onPageChange={pager.setPage}
            onPageSizeChange={pager.setPageSize}
          />
        </div>
      </div>
    </div>
  );
}
