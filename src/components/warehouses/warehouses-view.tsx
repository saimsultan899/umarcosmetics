"use client";

import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { WarehouseForm } from "@/components/forms/warehouse-form";
import {
  WarehousesList,
  type WarehouseListStats,
} from "@/components/tables/warehouses-list";
import { Button } from "@/components/ui/button";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useWarehousesList } from "@/hooks/use-warehouses-list";
import type { Company, Warehouse } from "@/lib/types/database";
import {
  BadgePercent,
  Building2,
  CheckCircle2,
  Package,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

export function WarehousesView({
  company,
  initialWarehouses = [],
  initialStats = {},
  initialOffline = false,
}: {
  company: Company;
  initialWarehouses?: Warehouse[];
  initialStats?: Record<string, WarehouseListStats>;
  initialOffline?: boolean;
}) {
  const {
    warehouses,
    statsByWarehouse,
    loading,
    totalCompanies,
    totalManagedProducts,
    totalInStockSkus,
    totalStockValuation,
    refetch,
  } = useWarehousesList({
    companyId: company.id,
    initialWarehouses,
    initialStats,
    initialOffline,
  });

  const [query, setQuery] = useState("");

  const filteredWarehouses = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return warehouses;
    return warehouses.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        (w.code && w.code.toLowerCase().includes(q)) ||
        (w.address && w.address.toLowerCase().includes(q)),
    );
  }, [warehouses, query]);

  if (loading && !warehouses.length) {
    return <PageSkeleton />;
  }

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Companies"
        description="Brand / stock companies — open one to see its products and stock."
        actions={
          <>
            <Link href="/inventory/expiry">
              <Button variant="secondary" size="sm">
                Expiry warehouse
              </Button>
            </Link>
            <Link href="/warehouses/transfers">
              <Button variant="secondary" size="sm">
                Stock transfer
              </Button>
            </Link>
            <CreateDialogButton
              label="Add company"
              title="Add company"
              description="Create a stock company or brand location"
            >
              <WarehouseForm
                companyId={company.id}
                organizationId={company.organization_id}
                onDone={refetch}
              />
            </CreateDialogButton>
          </>
        }
      />

      <StatsGrid>
        <StatCard
          label="Total Companies"
          value={totalCompanies}
          format="number"
          icon={Building2}
        />
        <StatCard
          label="Managed Products"
          value={totalManagedProducts}
          format="number"
          icon={Package}
        />
        <StatCard
          label="In-stock SKUs"
          value={totalInStockSkus}
          format="number"
          icon={CheckCircle2}
        />
        <StatCard
          label="Stock Valuation"
          value={totalStockValuation}
          format="money"
          icon={BadgePercent}
        />
      </StatsGrid>

      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search company name, code, or address…"
            className="pl-9"
          />
        </div>
        {query ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setQuery("")}
            className="text-xs text-[var(--muted)]"
          >
            Clear
          </Button>
        ) : null}
      </div>

      <WarehousesList
        warehouses={filteredWarehouses}
        companyId={company.id}
        organizationId={company.organization_id}
        statsByWarehouse={statsByWarehouse}
      />
    </div>
  );
}
