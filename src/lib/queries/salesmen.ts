import type { SupabaseClient } from "@supabase/supabase-js";

export type SalesmanOption = {
  user_id: string;
  full_name: string | null;
  phone?: string | null;
};

export async function fetchCompanySalesmen(
  supabase: SupabaseClient,
  companyId: string,
): Promise<SalesmanOption[]> {
  const { data, error } = await supabase
    .from("salesmen")
    .select("id, full_name, phone")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("full_name");

  if (error) throw new Error(error.message);

  return (data || []).map((s) => ({
    user_id: s.id,
    full_name: s.full_name || null,
    phone: s.phone || null,
  }));
}
