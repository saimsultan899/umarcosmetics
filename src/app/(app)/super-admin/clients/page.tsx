import { ClientsPanel } from "@/components/admin/clients-panel";
import { requireSuperAdmin } from "@/lib/auth";
import { listClients } from "@/lib/super-admin/clients";
import type { Company, Organization } from "@/lib/types/database";

export default async function SuperAdminClientsPage() {
  const { supabase, offline } = await requireSuperAdmin();
  if (offline) {
    const { renderOnlineOnlyModule } = await import(
      "@/lib/offline/render-offline-page"
    );
    return renderOnlineOnlyModule(
      "Clients",
      "Platform management requires an active internet connection.",
    );
  }

  let clients: Awaited<ReturnType<typeof listClients>> = [];
  let listError: string | null = null;
  try {
    clients = await listClients();
  } catch (err) {
    listError = err instanceof Error ? err.message : "Failed to load clients";
  }

  const [{ data: orgs }, { data: companies }] = await Promise.all([
    supabase.from("organizations").select("*").order("name"),
    supabase.from("companies").select("*").order("name"),
  ]);

  return (
    <div className="animate-rise space-y-4">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          Clients
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Create and manage distributor owner logins.
        </p>
      </div>
      {listError ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {listError}. Add{" "}
          <code className="font-mono text-xs">SUPABASE_SERVICE_ROLE_KEY</code>{" "}
          to your server environment to enable client provisioning.
        </p>
      ) : null}
      <ClientsPanel
        clients={clients}
        organizations={(orgs || []) as Organization[]}
        companies={(companies || []) as Company[]}
      />
    </div>
  );
}
