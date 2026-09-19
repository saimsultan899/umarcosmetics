import { SyncDashboard } from "@/components/offline/sync-dashboard";
import { requireCompanyContext } from "@/lib/auth";

export default async function SyncPage() {
  const { company } = await requireCompanyContext();

  return (
    <SyncDashboard companyId={company.id} companyName={company.name} />
  );
}
