"use client";

import { CompanyAdminForm } from "@/components/admin/company-admin-form";
import { CreateDialogButton } from "@/components/ui/create-dialog";
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { createClient } from "@/lib/supabase/client";
import type { Company, Organization } from "@/lib/types/database";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CompaniesPanel({
  companies,
  organizations,
}: {
  companies: Company[];
  organizations: Organization[];
}) {
  const router = useRouter();
  const orgName = Object.fromEntries(organizations.map((o) => [o.id, o.name]));
  const orgStatus = Object.fromEntries(
    organizations.map((o) => [o.id, o.status]),
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function isOpenable(c: Company) {
    return c.is_active && orgStatus[c.organization_id] !== "suspended";
  }

  async function openCompany(companyId: string) {
    setBusyId(companyId);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_active_company", {
      p_company_id: companyId,
    });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
            Companies
          </h2>
          <p className="text-sm text-[var(--muted)]">
            Inactive or suspended companies cannot be opened in the ERP
          </p>
        </div>
        <CreateDialogButton
          label="New company"
          title="New company"
          description="Creates company and default warehouse — attach a client from Clients or New client setup"
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
                  const orgSuspended =
                    orgStatus[c.organization_id] === "suspended";
                  const openable = isOpenable(c);
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
                      value: c.is_active
                        ? orgSuspended
                          ? "Active (org suspended)"
                          : "Active"
                        : "Inactive",
                    },
                  ];
                  return (
                    <tr
                      key={c.id}
                      className={!openable ? "opacity-75" : undefined}
                    >
                      <td>
                        <p className="font-medium">{c.name}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {c.code || "No code"}
                        </p>
                      </td>
                      <td>
                        <p>{orgName[c.organization_id] || "—"}</p>
                        {orgSuspended ? (
                          <p className="text-[10px] font-semibold uppercase text-amber-700">
                            Org suspended
                          </p>
                        ) : null}
                      </td>
                      <td>{c.city || "—"}</td>
                      <td>
                        <span
                          className={
                            openable
                              ? "rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold uppercase text-emerald-700"
                              : "rounded-full bg-rose-50 px-2 py-1 text-xs font-semibold uppercase text-rose-700"
                          }
                        >
                          {openable
                            ? "Active"
                            : c.is_active
                              ? "Blocked"
                              : "Inactive"}
                        </span>
                      </td>
                      <td className="text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {openable ? (
                            <button
                              type="button"
                              disabled={busyId === c.id}
                              className="rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--brand)] hover:bg-[var(--brand-soft)] disabled:opacity-50"
                              onClick={() => void openCompany(c.id)}
                            >
                              {busyId === c.id ? "Opening…" : "Open"}
                            </button>
                          ) : (
                            <span
                              className="rounded-lg px-2 py-1.5 text-xs text-[var(--muted)]"
                              title={
                                orgSuspended
                                  ? "Reactivate the organization first"
                                  : "Activate the company to open it"
                              }
                            >
                              Locked
                            </span>
                          )}
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
                                ? "Company will be locked. Anyone currently in it will be signed out of that workspace."
                                : "Company will be available again in the company selector."
                            }
                            onDelete={async () => {
                              const supabase = createClient();
                              const { error: rpcError } = await supabase.rpc(
                                "admin_set_company_active",
                                {
                                  p_company_id: c.id,
                                  p_is_active: !c.is_active,
                                },
                              );
                              if (rpcError) throw new Error(rpcError.message);
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={5}
                    className="py-8 text-center text-[var(--muted)]"
                  >
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
