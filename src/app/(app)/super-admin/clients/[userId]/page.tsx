import { ClientDetailPanel } from "@/components/admin/client-detail";
import { requireSuperAdmin } from "@/lib/auth";
import { listClients } from "@/lib/super-admin/clients";
import type { Company } from "@/lib/types/database";
import { notFound } from "next/navigation";

export default async function SuperAdminClientDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const { supabase, offline } = await requireSuperAdmin();
  if (offline) {
    const { renderOnlineOnlyModule } = await import(
      "@/lib/offline/render-offline-page"
    );
    return renderOnlineOnlyModule(
      "Client",
      "Platform management requires an active internet connection.",
    );
  }

  let clients: Awaited<ReturnType<typeof listClients>> = [];
  try {
    clients = await listClients();
  } catch {
    clients = [];
  }

  const client = clients.find((c) => c.id === userId);
  if (!client) notFound();

  const { data: companies } = await supabase
    .from("companies")
    .select("*")
    .eq("is_active", true)
    .order("name");

  return (
    <ClientDetailPanel
      client={client}
      companies={(companies || []) as Company[]}
    />
  );
}
