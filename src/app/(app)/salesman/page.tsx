import { SalesmanInviteForm } from "@/components/salesman/invite-form";
import { Button } from "@/components/ui/button";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { requireCompanyContext } from "@/lib/auth";
import Link from "next/link";

export default async function SalesmanAdminPage() {
  const { supabase, company } = await requireCompanyContext();

  const [{ data: members }, { data: invites }, { data: routes }] =
    await Promise.all([
      supabase
        .from("company_members")
        .select("*, profiles(full_name, phone)")
        .eq("company_id", company.id)
        .eq("role", "salesman")
        .eq("is_active", true),
      supabase
        .from("salesman_invites")
        .select("*")
        .eq("company_id", company.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("salesman_routes")
        .select("*, profiles(full_name)")
        .eq("company_id", company.id)
        .eq("is_active", true),
    ]);

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Salesman users & routes"
        description="Invite field staff and assign cities/routes for market collection"
        actions={
          <>
            <Link href="/field">
              <Button variant="secondary" size="sm">
                Open field app
              </Button>
            </Link>
            <CreateDialogButton
              label="Invite salesman"
              title="Invite salesman"
              description="Send an invite link for field staff"
              size="md"
            >
                <SalesmanInviteForm
                  companyId={company.id}
                  organizationId={company.organization_id}
                />
            </CreateDialogButton>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-5">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
            Active salesmen
          </h2>
          <div className="mt-4 space-y-2">
            {(members || []).length ? (
              members!.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl border border-[var(--border)] px-3 py-3 text-sm"
                >
                  <p className="font-medium">
                    {m.profiles?.full_name || "Salesman"}
                  </p>
                  <p className="text-xs text-[var(--muted)]">{m.user_id}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-[var(--muted)]">
                No salesman accounts yet.
              </p>
            )}
          </div>
        </div>

        <div className="panel p-5">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
            Route assignments
          </h2>
          <div className="mt-4 space-y-2">
            {(routes || []).length ? (
              routes!.map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl border border-[var(--border)] px-3 py-3 text-sm"
                >
                  <p className="font-medium">
                    {r.profiles?.full_name || "Salesman"}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {[r.route, r.city].filter(Boolean).join(" · ") || "Unscoped"}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-[var(--muted)]">
                No routes assigned yet.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="table-shell">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Status</th>
                <th>Invite link token</th>
              </tr>
            </thead>
            <tbody>
              {(invites || []).length ? (
                invites!.map((i) => (
                  <tr key={i.id}>
                    <td className="font-medium">{i.email}</td>
                    <td>{i.full_name || "—"}</td>
                    <td>
                      {i.claimed_by ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                          Claimed
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="font-mono text-xs text-[var(--muted)]">
                      {i.claimed_by ? "—" : `/join/${i.token}`}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={4}
                    className="py-8 text-center text-[var(--muted)]"
                  >
                    No invites yet.
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
