"use client";

import { SalesmanInviteForm } from "@/components/salesman/invite-form";
import { SalesmanForm } from "@/components/salesman/salesman-form";
import { SalesmanInvitesTable } from "@/components/tables/salesman-invites-table";
import {
  SalesmenTable,
  type SalesmanListRow,
} from "@/components/tables/salesmen-table";
import { Button } from "@/components/ui/button";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import {
  useSalesmenList,
  type SalesmanInviteRow,
} from "@/hooks/use-salesmen-list";
import type { Company } from "@/lib/types/database";
import Link from "next/link";

export function SalesmenView({
  company,
  initialRows = [],
  initialInvites = [],
  initialOffline = false,
  sectorOptions = [],
  cityOptions = [],
}: {
  company: Company;
  initialRows?: SalesmanListRow[];
  initialInvites?: SalesmanInviteRow[];
  initialOffline?: boolean;
  sectorOptions?: string[];
  cityOptions?: string[];
}) {
  const { rows, invites, loading, refetch } = useSalesmenList({
    companyId: company.id,
    initialRows,
    initialInvites,
    initialOffline,
  });

  if (loading && !rows.length) {
    return <PageSkeleton />;
  }

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Salesmen"
        description="Add field staff names to tag sale invoices and recoveries — no login needed"
        actions={
          <>
            <Link href="/sales/salesmen">
              <Button variant="secondary" size="sm">
                Salesman report
              </Button>
            </Link>
            <Link href="/salesman/routes">
              <Button variant="secondary" size="sm">
                Sector sheets
              </Button>
            </Link>
            <Link href="/salesman/recoveries">
              <Button variant="secondary" size="sm">
                Field recoveries
              </Button>
            </Link>
            <CreateDialogButton
              label="Salesman login"
              title="Salesman login"
              description="Create a login now, or copy an invite link. Mail is not sent."
              size="lg"
            >
              <SalesmanInviteForm
                companyId={company.id}
                organizationId={company.organization_id}
                salesmen={rows.map((row) => ({
                  id: row.id,
                  full_name: row.full_name,
                  user_id: row.user_id,
                }))}
                sectorOptions={sectorOptions}
                cityOptions={cityOptions}
              />
            </CreateDialogButton>
            <CreateDialogButton
              label="Add salesman"
              title="Add salesman"
              description="Name only — used on sale invoices and recoveries"
              size="md"
            >
              <SalesmanForm
                companyId={company.id}
                organizationId={company.organization_id}
                onDone={refetch}
              />
            </CreateDialogButton>
          </>
        }
      />

      <SalesmenTable
        rows={rows}
        companyId={company.id}
        organizationId={company.organization_id}
      />

      {invites.length > 0 ? (
        <SalesmanInvitesTable rows={invites} />
      ) : null}
    </div>
  );
}
