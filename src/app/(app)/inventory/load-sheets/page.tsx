import { LoadSheetsTable } from "@/components/tables/load-sheets-table";
import { LoadSheetForm } from "@/components/trading/load-sheet-form";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { requireCompanyContext } from "@/lib/auth";
import { formatNumber } from "@/lib/utils";

export default async function LoadSheetsPage() {
  const { supabase, company } = await requireCompanyContext();

  const [{ data: products }, { data: warehouses }, { data: members }, { data: sheets }] =
    await Promise.all([
      supabase
        .from("products")
        .select("*")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("code"),
      supabase
        .from("warehouses")
        .select("*")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("company_members")
        .select("user_id, profiles(full_name)")
        .eq("company_id", company.id)
        .eq("role", "salesman")
        .eq("is_active", true),
      supabase
        .from("load_sheets")
        .select(
          "id, sheet_no, sheet_date, vehicle_no, route, status, warehouses(name), load_sheet_items(qty)",
        )
        .eq("company_id", company.id)
        .order("sheet_date", { ascending: false })
        .limit(40),
    ]);

  const salesmen = (members || []).map((m) => {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return { user_id: m.user_id, full_name: profile?.full_name || null };
  });

  const canCreate =
    (warehouses || []).length > 0 && (products || []).length > 0;

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Van load sheets"
        description={`Issue stock to salesman vans before market — for ${company.name}`}
        actions={
          <CreateDialogButton
            label="Create load"
            title="Create load sheet"
            description="Issue van stock for a market sector"
            size="xl"
            disabled={!canCreate}
            disabledHint="Add products and warehouses first, then create van loads."
          >
              <LoadSheetForm
                companyId={company.id}
                organizationId={company.organization_id}
                products={products || []}
                warehouses={warehouses || []}
                salesmen={salesmen}
              />
          </CreateDialogButton>
        }
      />

      <LoadSheetsTable
        rows={(sheets || []).map((s) => {
          const wh = Array.isArray(s.warehouses) ? s.warehouses[0] : s.warehouses;
          const qty = (s.load_sheet_items || []).reduce(
            (sum: number, i: { qty: number }) => sum + Number(i.qty || 0),
            0,
          );
          return {
            id: s.id,
            sheet_no: s.sheet_no,
            sheet_date: s.sheet_date,
            warehouse: wh?.name || "—",
            vehicle_route:
              [s.vehicle_no, s.route].filter(Boolean).join(" · ") || "—",
            qty: formatNumber(qty, 0),
            status: s.status,
          };
        })}
      />
    </div>
  );
}
