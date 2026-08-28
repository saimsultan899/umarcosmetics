import { one } from "@/lib/reports/helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SalesmanOption = {
  user_id: string;
  full_name: string | null;
};

export async function fetchCompanySalesmen(
  supabase: SupabaseClient,
  companyId: string,
): Promise<SalesmanOption[]> {
  const { data, error } = await supabase
    .from("company_members")
    .select("user_id, profiles(full_name)")
    .eq("company_id", companyId)
    .eq("role", "salesman")
    .eq("is_active", true);

  if (error) throw new Error(error.message);

  return ((data || []) as Array<{
    user_id: string | null;
    profiles: { full_name: string | null } | { full_name: string | null }[] | null;
  }>)
    .map((m) => {
      const p = one(m.profiles);
      return {
        user_id: m.user_id || "",
        full_name: p?.full_name || null,
      };
    })
    .filter((s) => s.user_id)
    .sort((a, b) =>
      (a.full_name || "").localeCompare(b.full_name || "", undefined, {
        sensitivity: "base",
      }),
    );
}
