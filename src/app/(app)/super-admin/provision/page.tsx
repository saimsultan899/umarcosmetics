import { ProvisionWizard } from "@/components/admin/provision-wizard";
import { requireSuperAdmin } from "@/lib/auth";

export default async function SuperAdminProvisionPage() {
  const { offline } = await requireSuperAdmin();
  if (offline) {
    const { renderOnlineOnlyModule } = await import(
      "@/lib/offline/render-offline-page"
    );
    return renderOnlineOnlyModule(
      "New client",
      "Platform management requires an active internet connection.",
    );
  }

  return <ProvisionWizard />;
}
