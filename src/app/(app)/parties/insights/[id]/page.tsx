import { PartyInsightsView } from "@/components/parties/party-insights-view";
import { requireCompanyContext } from "@/lib/auth";
import { notFound } from "next/navigation";

export default async function PartyInsightsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, company, offline } = await requireCompanyContext();

  if (offline) {
    return (
      <PartyInsightsView
        companyId={company.id}
        partyId={id}
        initialOffline={true}
      />
    );
  }

  const { data: party } = await supabase
    .from("parties")
    .select("*")
    .eq("company_id", company.id)
    .eq("id", id)
    .maybeSingle();

  if (!party) notFound();

  return (
    <PartyInsightsView
      companyId={company.id}
      partyId={id}
      initialParty={party}
      initialOffline={false}
    />
  );
}
