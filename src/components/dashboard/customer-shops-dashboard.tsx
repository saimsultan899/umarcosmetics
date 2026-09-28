"use client";

import { PartyForm } from "@/components/forms/party-form";
import { TableScroll } from "@/components/tables/table-scroll";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { RowActions } from "@/components/ui/row-actions";
import { usePartiesList } from "@/hooks/use-parties-list";
import { useSearchInput, useUrlTableState } from "@/hooks/use-url-table-state";
import type { PartyListResult } from "@/lib/queries/parties";
import { offlineAwareSubmit } from "@/lib/offline/offline-submit";
import { putCachedRow } from "@/lib/offline/local-db";
import { hasLocalSqlite, localUpsertMaster } from "@/lib/offline/sqlite-client";
import type { Company, Party } from "@/lib/types/database";
import { formatPkr } from "@/lib/utils";

export function CustomerShopsDashboard({
  company,
  initialData,
  initialOffline = false,
  canEdit = false,
  canInactivate = false,
}: {
  company: Company;
  initialData?: PartyListResult | null;
  initialOffline?: boolean;
  canEdit?: boolean;
  canInactivate?: boolean;
}) {
  const { q, isPending, setPage, setPageSize, setQuery } = useUrlTableState();
  const search = useSearchInput(q, setQuery);
  const { data, loading, refetch } = usePartiesList({
    companyId: company.id,
    initialData,
    initialOffline,
    fixedSubtype: "customer",
  });

  async function setActive(party: Party, isActive: boolean) {
    const payload = { ...party, is_active: isActive };
    try {
      await offlineAwareSubmit({
        mutationType: "party_update",
        companyId: company.id,
        organizationId: company.organization_id,
        cacheStore: "parties",
        cacheRecord: payload,
        payload,
      });
    } catch {
      if (hasLocalSqlite()) {
        await localUpsertMaster("parties", payload).catch(() => {});
      }
      await putCachedRow("parties", company.id, payload).catch(() => {});
    }
    await refetch();
  }

  if (loading && !data) {
    return <PageSkeleton />;
  }

  const parties = data?.parties || [];
  const pagination = data?.pagination || {
    page: 1,
    pageSize: 24 as const,
    total: 0,
    totalPages: 1,
    from: 0,
    to: 0,
  };

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Customers / Shops"
        description={`${company.name}. Every shop is loaded from this company. Edit a shop, or mark it inactive so it stays on old bills and drops off new ones.`}
        actions={
          canEdit ? (
            <CreateDialogButton
              label="Add customer"
              title="Add customer"
              description="Create a shop for this company"
              size="lg"
            >
              <PartyForm
                companyId={company.id}
                organizationId={company.organization_id}
                cityOptions={data?.cityOptions || []}
                sectorOptions={data?.sectorOptions || []}
                defaultSubtype="customer"
                defaultPartyType="PARTY"
                onDone={refetch}
              />
            </CreateDialogButton>
          ) : null
        }
      />

      <TableToolbar
        query={search.query}
        onQueryChange={search.onQueryChange}
        onFocus={search.onFocus}
        onBlur={search.onBlur}
        placeholder="Search code, shop, city, sector, phone..."
        resultCount={pagination.total}
        totalCount={pagination.total}
      />

      <div className="table-shell">
        <TableScroll loading={isPending || loading}>
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Shop</th>
                <th>City / Sector</th>
                <th>Phone</th>
                <th>Opening balance</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {parties.length ? (
                parties.map((party) => (
                  <tr
                    key={party.id}
                    className={!party.is_active ? "opacity-60" : undefined}
                  >
                    <td className="font-medium">{party.party_code}</td>
                    <td>
                      <div className="font-medium">{party.name_en}</div>
                      {!party.is_active ? (
                        <span className="mt-1 inline-block rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--muted)]">
                          Inactive
                        </span>
                      ) : null}
                    </td>
                    <td className="text-[var(--muted)]">
                      {[party.city || party.head, party.route]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td>{party.mobile || party.phone || "—"}</td>
                    <td>{formatPkr(party.opening_balance)}</td>
                    <td>
                      <RowActions
                        viewTitle={party.name_en}
                        editTitle={`Edit ${party.name_en}`}
                        deleteTitle={`Mark ${party.name_en} inactive?`}
                        deleteDescription="The shop stays on old bills and is hidden from new sales. This does not erase it."
                        viewFields={[
                          { label: "Code", value: party.party_code },
                          { label: "Shop", value: party.name_en },
                          {
                            label: "City / Sector",
                            value:
                              [party.city || party.head, party.route]
                                .filter(Boolean)
                                .join(" · ") || "—",
                          },
                          { label: "Phone", value: party.mobile || party.phone || "—" },
                          {
                            label: "Opening balance",
                            value: formatPkr(party.opening_balance),
                          },
                          {
                            label: "Status",
                            value: party.is_active ? "Active" : "Inactive",
                          },
                        ]}
                        allowEdit={canEdit}
                        allowDelete={canInactivate && party.is_active}
                        onDelete={() => setActive(party, false)}
                        editContent={(close) => (
                          <PartyForm
                            companyId={company.id}
                            organizationId={company.organization_id}
                            cityOptions={data?.cityOptions || []}
                            sectorOptions={data?.sectorOptions || []}
                            initial={party}
                            onDone={() => {
                              close();
                              void refetch();
                            }}
                          />
                        )}
                      />
                      {!party.is_active && canInactivate ? (
                        <button
                          type="button"
                          className="ml-1 text-xs font-medium text-[var(--brand-strong)]"
                          onClick={() => void setActive(party, true)}
                        >
                          Restore
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[var(--muted)]">
                    No customers or shops for this company yet.
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
          loading={isPending || loading}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>
    </div>
  );
}
