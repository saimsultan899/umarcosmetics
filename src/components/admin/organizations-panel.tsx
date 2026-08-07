"use client";

import { OrganizationForm } from "@/components/admin/organization-form";
import {
  CreateDialogButton,
} from "@/components/ui/create-dialog";
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { createClient } from "@/lib/supabase/client";
import type { Organization } from "@/lib/types/database";

export function OrganizationsPanel({
  organizations,
  companyCounts,
}: {
  organizations: Organization[];
  companyCounts: Record<string, number>;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
            Organizations
          </h2>
          <p className="text-sm text-[var(--muted)]">
            Distributor groups that own one or more companies
          </p>
        </div>
        <CreateDialogButton
          label="New organization"
          title="New organization"
          description="Create a distributor organization"
        >
          <OrganizationForm />
        </CreateDialogButton>
      </div>

      <div className="table-shell">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Companies</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {organizations.length ? (
                organizations.map((o) => {
                  const fields: DetailField[] = [
                    { label: "Name", value: o.name },
                    { label: "Status", value: o.status },
                    {
                      label: "Companies",
                      value: String(companyCounts[o.id] || 0),
                    },
                    {
                      label: "Created",
                      value: new Date(o.created_at).toLocaleString(),
                    },
                  ];
                  return (
                    <tr key={o.id}>
                      <td className="font-medium">{o.name}</td>
                      <td>
                        <span
                          className={
                            o.status === "active"
                              ? "rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold uppercase text-emerald-700"
                              : "rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold uppercase text-amber-800"
                          }
                        >
                          {o.status}
                        </span>
                      </td>
                      <td>{companyCounts[o.id] || 0}</td>
                      <td className="text-right">
                        <RowActions
                          viewTitle={o.name}
                          viewFields={fields}
                          editTitle={`Edit ${o.name}`}
                          editContent={(close) => (
                            <OrganizationForm
                              initial={o}
                              onDone={close}
                            />
                          )}
                          deleteTitle={
                            o.status === "active"
                              ? `Suspend ${o.name}?`
                              : `Reactivate ${o.name}?`
                          }
                          deleteDescription={
                            o.status === "active"
                              ? "Organization will be marked suspended. Companies stay in the database."
                              : "Organization will be set back to active."
                          }
                          onDelete={async () => {
                            const supabase = createClient();
                            const next =
                              o.status === "active" ? "suspended" : "active";
                            const { error } = await supabase
                              .from("organizations")
                              .update({ status: next })
                              .eq("id", o.id);
                            if (error) throw new Error(error.message);
                          }}
                        />
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-[var(--muted)]">
                    No organizations yet. Create one to add companies under it.
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
