"use client";

import { useSyncStatus } from "@/components/offline/sync-provider";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { formatPkr } from "@/lib/utils";
import { useEffect, useState } from "react";

export default function SyncSettingsPage() {
  const { online, pending, syncing, lastMessage, runSync, refreshPending } =
    useSyncStatus();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [sessions, setSessions] = useState<
    Array<{
      id: string;
      started_at: string;
      status: string;
      success_count: number;
      failed_count: number;
      pending_count: number;
    }>
  >([]);
  const [closingMsg, setClosingMsg] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("active_company_id, organization_id")
        .eq("id", user.id)
        .single();
      if (!profile?.active_company_id) return;
      setCompanyId(profile.active_company_id);
      setOrganizationId(profile.organization_id);

      const today = new Date().toISOString().slice(0, 10);
      const [{ data: daySummary }, { data: syncSessions }] = await Promise.all([
        supabase.rpc("get_day_closing_summary", {
          p_company_id: profile.active_company_id,
          p_date: today,
        }),
        supabase
          .from("sync_sessions")
          .select("*")
          .eq("company_id", profile.active_company_id)
          .order("started_at", { ascending: false })
          .limit(10),
      ]);
      setSummary((daySummary as Record<string, number>) || null);
      setSessions(syncSessions || []);
      await refreshPending();
    }
    void load();
  }, [refreshPending]);

  async function syncAndClose() {
    if (!companyId || !organizationId) return;
    setClosingMsg(null);
    const result = await (async () => {
      await runSync();
      return true;
    })();

    const supabase = createClient();
    // Get latest sync session
    const { data: latest } = await supabase
      .from("sync_sessions")
      .select("id")
      .eq("company_id", companyId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { error } = await supabase.rpc("save_day_closing", {
      p_payload: {
        organization_id: organizationId,
        company_id: companyId,
        closing_date: new Date().toISOString().slice(0, 10),
        sync_session_id: latest?.id || null,
      },
    });

    if (error) {
      setClosingMsg(error.message);
      return;
    }
    setClosingMsg(
      result
        ? "Night closing saved. Summary locked for today."
        : "Closing saved.",
    );

    const { data: daySummary } = await supabase.rpc("get_day_closing_summary", {
      p_company_id: companyId,
      p_date: new Date().toISOString().slice(0, 10),
    });
    setSummary((daySummary as Record<string, number>) || null);
  }

  return (
    <div className="animate-rise mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          Offline / Sync
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Work offline all day. Connect internet at closing and sync to cloud.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="stat-tile">
          <p className="text-xs uppercase text-[var(--muted)]">Connection</p>
          <p className="mt-2 text-xl font-semibold">{online ? "Online" : "Offline"}</p>
        </div>
        <div className="stat-tile">
          <p className="text-xs uppercase text-[var(--muted)]">Pending local</p>
          <p className="mt-2 text-xl font-semibold">{pending}</p>
        </div>
        <div className="stat-tile">
          <p className="text-xs uppercase text-[var(--muted)]">Status</p>
          <p className="mt-2 text-xl font-semibold">{syncing ? "Syncing" : "Idle"}</p>
        </div>
      </div>

      {lastMessage ? (
        <p className="rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-sm">
          {lastMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button onClick={() => void runSync()} disabled={!online || syncing}>
          {syncing ? "Syncing..." : "Sync now"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void syncAndClose()}
          disabled={!online || syncing}
        >
          Sync & night closing
        </Button>
      </div>

      {closingMsg ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {closingMsg}
        </p>
      ) : null}

      {summary ? (
        <div className="panel p-5">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
            Today closing preview
          </h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 text-sm">
            <p>Sales total: <strong>{formatPkr(summary.sales_total || 0)}</strong></p>
            <p>Cash / paid: <strong>{formatPkr(summary.cash_sales || 0)}</strong></p>
            <p>Credit sales: <strong>{formatPkr(summary.credit_sales || 0)}</strong></p>
            <p>Recoveries: <strong>{formatPkr(summary.recoveries_total || 0)}</strong></p>
            <p>Purchases: <strong>{formatPkr(summary.purchases_total || 0)}</strong></p>
          </div>
        </div>
      ) : null}

      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <th>Started</th>
              <th>Status</th>
              <th>Pending</th>
              <th>Success</th>
              <th>Failed</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length ? (
              sessions.map((s) => (
                <tr key={s.id}>
                  <td>{new Date(s.started_at).toLocaleString()}</td>
                  <td className="uppercase text-xs font-semibold">{s.status}</td>
                  <td>{s.pending_count}</td>
                  <td>{s.success_count}</td>
                  <td>{s.failed_count}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="py-8 text-center text-[var(--muted)]">
                  No sync sessions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
