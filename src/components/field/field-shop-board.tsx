"use client";

import { TableFilterSelect } from "@/components/tables/table-filter-select";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableScroll } from "@/components/tables/table-scroll";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { useClientPagination } from "@/hooks/use-client-pagination";
import { formatPkr } from "@/lib/utils";
import Link from "next/link";
import { useMemo, useState } from "react";

export type FieldShop = {
  party_id: string;
  party_code: string;
  name_en: string;
  city: string | null;
  route: string | null;
  mobile: string | null;
  balance: number;
};

export function FieldShopBoard({
  shops,
  canSell,
  canCollect,
  canEdit,
}: {
  shops: FieldShop[];
  canSell: boolean;
  canCollect: boolean;
  canEdit: boolean;
}) {
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("");
  const [city, setCity] = useState("");
  const [due, setDue] = useState("");

  const sectors = useMemo(() => {
    const names = new Set<string>();
    for (const shop of shops) if (shop.route) names.add(shop.route);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [shops]);
  const cities = useMemo(() => {
    const names = new Set<string>();
    for (const shop of shops) if (shop.city) names.add(shop.city);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [shops]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return shops.filter((shop) => {
      if (sector && shop.route !== sector) return false;
      if (city && shop.city !== city) return false;
      const balance = Number(shop.balance || 0);
      if (due === "due" && balance <= 0) return false;
      if (due === "nil" && Math.abs(balance) >= 0.005) return false;
      if (!q) return true;
      return `${shop.party_code} ${shop.name_en} ${shop.city || ""} ${shop.mobile || ""} ${shop.route || ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [shops, query, sector, city, due]);

  const page = useClientPagination(visible);

  return (
    <div>
      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search shop, city, or phone"
        resultCount={page.total}
        totalCount={shops.length}
        filters={
          <>
            <TableFilterSelect
              label="Sector"
              value={sector}
              allLabel="All sectors"
              options={sectors.map((name) => ({ value: name, label: name }))}
              onChange={(value) => setSector(value || "")}
            />
            <TableFilterSelect
              label="City"
              value={city}
              allLabel="All cities"
              options={cities.map((name) => ({ value: name, label: name }))}
              onChange={(value) => setCity(value || "")}
            />
            <TableFilterSelect
              label="Balance"
              value={due}
              allLabel="All"
              options={[
                { value: "due", label: "Due" },
                { value: "nil", label: "Nil" },
              ]}
              onChange={(value) => setDue(value || "")}
            />
            {canEdit ? (
              <Link
                href="/parties?type=customer"
                className="inline-flex h-9 items-center rounded-[var(--radius-sm)] bg-[var(--brand)] px-3 text-sm font-semibold text-white"
              >
                Edit customers
              </Link>
            ) : null}
          </>
        }
      />
      <div className="table-shell">
        <TableScroll loading={page.isPending}>
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Shop</th>
                <th>Sector</th>
                <th>City</th>
                <th>Phone</th>
                <th className="text-right">Balance</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {page.slice.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[var(--muted)]">
                    No shops match.
                  </td>
                </tr>
              ) : (
                page.slice.map((shop) => {
                  const balance = Number(shop.balance || 0);
                  return (
                    <tr key={shop.party_id}>
                      <td className="font-medium">{shop.party_code}</td>
                      <td>{shop.name_en}</td>
                      <td>{shop.route || "—"}</td>
                      <td>{shop.city || "—"}</td>
                      <td>{shop.mobile || "—"}</td>
                      <td
                        className={`text-right font-semibold ${
                          balance > 0
                            ? "text-rose-700"
                            : balance < 0
                              ? "text-emerald-700"
                              : "text-[var(--muted)]"
                        }`}
                      >
                        {Math.abs(balance) < 0.005
                          ? "Nil"
                          : `${formatPkr(Math.abs(balance))} ${balance > 0 ? "Dr" : "Cr"}`}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1.5">
                          <Link
                            href="/field/order"
                            className="inline-flex h-8 items-center rounded-[var(--radius-sm)] bg-[var(--brand)] px-2.5 text-xs font-semibold text-white"
                          >
                            Order
                          </Link>
                          {canSell ? (
                            <Link
                              href={`/field/sale?party=${shop.party_id}`}
                              className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--border)] px-2.5 text-xs font-semibold"
                            >
                              Sale
                            </Link>
                          ) : null}
                          {canCollect ? (
                            <Link
                              href={`/field/recovery?party=${shop.party_id}`}
                              className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--border)] px-2.5 text-xs font-semibold"
                            >
                              Collect
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TableScroll>
        <TablePagination
          page={page.page}
          totalPages={page.totalPages}
          pageSize={page.pageSize}
          total={page.total}
          from={page.from}
          to={page.to}
          loading={page.isPending}
          onPageChange={page.setPage}
          onPageSizeChange={page.setPageSize}
        />
      </div>
    </div>
  );
}
