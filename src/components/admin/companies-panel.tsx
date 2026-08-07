"use client";

import { CompanyAdminForm } from "@/components/admin/company-admin-form";
import { CreateDialogButton } from "@/components/ui/create-dialog";
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { createClient } from "@/lib/supabase/client";
import type { Company, Organization } from "@/lib/types/database";
import { useRouter } from "next/navigation";

export function CompaniesPanel({
  companies,
  organizations,
}: {
  companies: Company[];
  organizations: Organization[];
}) {
  const router = useRouter();
  const orgName = Object.fromEntries(organizations.map((o) => [o.id, o.name]));

  async function openCompany(companyId: string) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in");
    const { error } = await supabase
      .from("profiles")
      .update({ active_company_id: companyId })
      .eq("id", user.id);
    if (error) throw new Error(error.message);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
            Companies
          </h2>
          <p className="text-sm text-[var(--muted)]">
            Isolated distributor workspaces under an organization
          </p>
        </div>
        <CreateDialogButton
          label="New company"
          title="New company"
          description="Creates company, default warehouse, and your admin access"
          disabled={!organizations.length}
          disabledHint="Create an organization first"
        >
          <CompanyAdminForm organizations={organizations} />
        </CreateDialogButton>
      </div>

      <div className="table-shell">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Organization</th>
                <th>City</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {companies.length ? (
                companies.map((c) => {
                  const fields: DetailField[] = [
                    { label: "Name", value: c.name },
                    { label: "Code", value: c.code || "—" },
                    {
                      label: "Organization",
                      value: orgName[c.organization_id] || "—",
                    },
                    { label: "City", value: c.city || "—" },
                    { label: "Address", value: c.address || "—" },
                    { label: "Phone", value: c.phone || "—" },
                    { label: "NTN", value: c.ntn || "—" },
                    {
                      label: "Status",
                      value: c.is_active ? "Active" : "Inactive",
                    },
                  ];
                  return (
                    <tr key={c.id}>
                      <td>
                        <p className="font-medium">{c.name}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {c.code || "No code"}
                        </p>
                      </td>
                      <td>{orgName[c.organization_id] || "—"}</td>
                      <td>{c.city || "—"}</td>
                      <td>
                        <span
                          className={
                            c.is_active
                              ? "rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold uppercase text-emerald-700"
                              : "rounded-full bg-rose-50 px-2 py-1 text-xs font-semibold uppercase text-rose-700"
                          }
                        >
                          {c.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <button
                            type="button"
                            className="rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--brand)] hover:bg-[var(--brand-soft)]"
                            onClick={() => void openCompany(c.id)}
                          >
                            Open
                          </button>
                          <RowActions
                            viewTitle={c.name}
                            viewFields={fields}
                            editTitle={`Edit ${c.name}`}
                            editContent={(close) => (
                              <CompanyAdminForm
                                organizations={organizations}
                                initial={c}
                                onDone={close}
                              />
                            )}
                            deleteTitle={
                              c.is_active
                                ? `Deactivate ${c.name}?`
                                : `Activate ${c.name}?`
                            }
                            deleteDescription={
                              c.is_active
                                ? "Company will be hidden from selectors. Data is kept."
                                : "Company will be available again in the company selector."
                            }
                            onDelete={async () => {
                              const supabase = createClient();
                              const { error } = await supabase
                                .from("companies")
                                .update({ is_active: !c.is_active })
                                .eq("id", c.id);
                              if (error) throw new Error(error.message);
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[var(--muted)]">
                    No companies yet. Create one under an organization.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
