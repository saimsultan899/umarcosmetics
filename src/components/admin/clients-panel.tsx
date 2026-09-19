"use client";

import { ClientForm } from "@/components/admin/client-form";
import { CreateDialogButton } from "@/components/ui/create-dialog";
import type { Company, Organization } from "@/lib/types/database";
import type { ClientListItem } from "@/lib/super-admin/clients";
import Link from "next/link";

export function ClientsPanel({
  clients,
  organizations,
  companies,
}: {
  clients: ClientListItem[];
  organizations: Organization[];
  companies: Company[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
            Clients
          </h2>
          <p className="text-sm text-[var(--muted)]">
            Logins you create for distributor owners (not platform super admins)
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/super-admin/provision"
            className="inline-flex rounded-lg bg-[var(--brand)] px-3 py-2 text-sm font-semibold !text-white"
          >
            New client setup
          </Link>
          <CreateDialogButton
            label="Add login only"
            title="Create client login"
            description="Attach to existing organization and companies"
          >
            <ClientForm organizations={organizations} companies={companies} />
          </CreateDialogButton>
        </div>
      </div>

      <div className="table-shell">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Email</th>
                <th>Companies</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.length ? (
                clients.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <p className="font-medium">{c.full_name || "Unnamed"}</p>
                      {c.phone ? (
                        <p className="text-xs text-[var(--muted)]">{c.phone}</p>
                      ) : null}
                    </td>
                    <td className="font-mono text-xs">{c.email || "—"}</td>
                    <td>
                      <p className="text-sm">{c.company_count}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {c.companies
                          .filter((x) => x.is_active)
                          .slice(0, 2)
                          .map((x) => x.name)
                          .join(", ") || "None"}
                        {c.company_count > 2 ? "…" : ""}
                      </p>
                    </td>
                    <td>
                      <span
                        className={
                          c.banned
                            ? "rounded-full bg-rose-50 px-2 py-1 text-xs font-semibold uppercase text-rose-700"
                            : "rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold uppercase text-emerald-700"
                        }
                      >
                        {c.banned ? "Disabled" : "Active"}
                      </span>
                    </td>
                    <td className="text-right">
                      <Link
                        href={`/super-admin/clients/${c.id}`}
                        className="text-xs font-semibold text-[var(--brand)]"
                      >
                        Manage
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[var(--muted)]">
                    No clients yet. Use New client setup to create org, companies,
                    and login together.
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
