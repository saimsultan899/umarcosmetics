"use client";

import { useSyncStatus } from "@/components/offline/sync-provider";
import { getMutationLabel } from "@/lib/offline/sync-engine";
import { formatCacheAge } from "@/hooks/use-offline-data";
import {
  Cloud,
  CloudOff,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Loader2,
  Trash2,
  HardDrive,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  listPendingMutations,
  getLastSync as getLastSyncTime,
  removeMutation,
  type OfflineMutation,
} from "@/lib/offline/local-db";
import { checkCacheFreshness, refreshAllCaches } from "@/lib/offline/cache-manager";
import type { CacheStoreName } from "@/lib/offline/local-db";

export function SyncDashboard({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName?: string;
}) {
  const {
    online,
    pending,
    syncing,
    syncProgress,
    lastSync,
    lastResult,
    lastMessage,
    runSync,
    refreshPending,
  } = useSyncStatus();

  const [mutations, setMutations] = useState<OfflineMutation[]>([]);
  const [cacheStatus, setCacheStatus] = useState<{
    stale: CacheStoreName[];
    fresh: CacheStoreName[];
    missing: CacheStoreName[];
  } | null>(null);
  const [refreshingCache, setRefreshingCache] = useState(false);

  // Load mutations list
  useEffect(() => {
    loadMutations();
    const timer = setInterval(loadMutations, 5000);
    return () => clearInterval(timer);
  }, [companyId]);

  async function loadMutations() {
    try {
      const list = await listPendingMutations(companyId);
      setMutations(list);
    } catch {
      setMutations([]);
    }
  }

  // Load cache status
  useEffect(() => {
    loadCacheStatus();
  }, [companyId]);

  async function loadCacheStatus() {
    try {
      const status = await checkCacheFreshness(companyId);
      setCacheStatus(status);
    } catch {
      setCacheStatus(null);
    }
  }

  async function handleRefreshCache() {
    setRefreshingCache(true);
    try {
      await refreshAllCaches(companyId);
      await loadCacheStatus();
    } finally {
      setRefreshingCache(false);
    }
  }

  async function handleDeleteMutation(id: string) {
    if (!confirm("Remove this queued record? It will NOT be synced to the server.")) return;
    await removeMutation(id);
    await loadMutations();
    await refreshPending();
  }

  // ── Status banner ─────────────────────────────────────────────────
  const statusColor = online
    ? pending.total > 0
      ? "bg-amber-50 border-amber-200 text-amber-800"
      : "bg-emerald-50 border-emerald-200 text-emerald-800"
    : "bg-red-50 border-red-200 text-red-800";

  const StatusIcon = online
    ? pending.total > 0
      ? Clock
      : CheckCircle2
    : CloudOff;

  return (
    <div className="animate-rise space-y-6">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">
            Sync & Offline Data
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Manage offline queue, sync to cloud, and monitor local cache
            {companyName ? ` for ${companyName}` : ""}.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void runSync()}
          disabled={syncing || !online || pending.total === 0}
          className="flex items-center gap-2 rounded-lg bg-[var(--brand)] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[var(--brand-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Cloud className="h-4 w-4" />
          )}
          {syncing ? "Syncing…" : "Sync Now"}
        </button>
      </div>

      {/* ── Status banner ──────────────────────────────────────────── */}
      <div className={`flex items-center gap-3 rounded-lg border p-4 ${statusColor}`}>
        <StatusIcon className="h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {online
              ? pending.total > 0
                ? `${pending.total} record${pending.total !== 1 ? "s" : ""} waiting to sync`
                : "All data synced to cloud"
              : "Working offline — data is saved locally"}
          </p>
          {lastSync && (
            <p className="mt-0.5 text-xs opacity-70">
              Last sync: {new Date(lastSync).toLocaleString()}
            </p>
          )}
        </div>
      </div>

      {/* ── Sync progress ──────────────────────────────────────────── */}
      {syncing && syncProgress && (
        <div className="rounded-lg border border-[var(--border)] bg-white p-4">
          <div className="mb-2 flex justify-between text-sm">
            <span className="font-medium">
              Syncing {getMutationLabel(syncProgress.currentType)}…
            </span>
            <span className="text-[var(--ink-muted)]">
              {syncProgress.current} / {syncProgress.total}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full bg-[var(--brand)] transition-all duration-300"
              style={{
                width: `${(syncProgress.current / syncProgress.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* ── Last result ────────────────────────────────────────────── */}
      {lastResult && !syncing && (
        <div
          className={`rounded-lg border p-4 ${
            lastResult.failed === 0
              ? "border-emerald-200 bg-emerald-50"
              : "border-amber-200 bg-amber-50"
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            {lastResult.failed === 0 ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            )}
            {lastMessage}
          </div>
          {lastResult.errors.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-red-700">
              {lastResult.errors.map((err) => (
                <li key={err.id}>
                  {getMutationLabel(err.type)}: {err.message}
                </li>
              ))}
            </ul>
          )}
          {lastResult.errors.some((e) =>
            e.message.toLowerCase().includes("insufficient stock"),
          ) ? (
            <p className="mt-2 text-xs text-amber-800">
              Cloud stock is lower than these offline sales. Post a purchase
              invoice (or fix stock) for that warehouse, then Sync Now again —
              or delete the failed queue rows if they were mistakes.
            </p>
          ) : null}
        </div>
      )}

      {/* ── Stats cards ────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
            <Clock className="h-4 w-4" />
            Pending Queue
          </div>
          <p className="mt-1 text-2xl font-semibold text-[var(--ink)]">
            {pending.total}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
            {online ? (
              <Cloud className="h-4 w-4 text-emerald-600" />
            ) : (
              <CloudOff className="h-4 w-4 text-red-500" />
            )}
            Connection
          </div>
          <p className="mt-1 text-2xl font-semibold text-[var(--ink)]">
            {online ? "Online" : "Offline"}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
            <HardDrive className="h-4 w-4" />
            Local Cache
          </div>
          <p className="mt-1 text-2xl font-semibold text-[var(--ink)]">
            {cacheStatus
              ? `${cacheStatus.fresh.length} fresh · ${cacheStatus.stale.length + cacheStatus.missing.length} stale`
              : "—"}
          </p>
          <button
            type="button"
            disabled={!online || refreshingCache}
            onClick={handleRefreshCache}
            className="mt-2 flex items-center gap-1 text-xs text-[var(--brand)] hover:underline disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${refreshingCache ? "animate-spin" : ""}`} />
            Refresh caches
          </button>
        </div>
      </div>

      {/* ── Pending by type ────────────────────────────────────────── */}
      {Object.keys(pending.byType).length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-white">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="font-medium text-[var(--ink)]">Pending by type</h2>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {Object.entries(pending.byType).map(([type, count]) => (
              <div key={type} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm text-[var(--ink)]">
                  {getMutationLabel(type)}
                </span>
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Mutation queue detail ───────────────────────────────────── */}
      {mutations.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-white">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="font-medium text-[var(--ink)]">
              Queued records ({mutations.length})
            </h2>
          </div>
          <div className="max-h-[400px] divide-y divide-[var(--border)] overflow-y-auto">
            {mutations.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--ink)]">
                    {getMutationLabel(m.type)}
                    {m.localId && (
                      <span className="ml-2 text-xs text-[var(--ink-muted)]">
                        {m.localId}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {new Date(m.createdAt).toLocaleString()} · Attempts: {m.attempts}
                    {m.status === "failed" && m.error && (
                      <span className="ml-1 text-red-600">· {m.error}</span>
                    )}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                    m.status === "failed"
                      ? "bg-red-100 text-red-700"
                      : m.status === "syncing"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {m.status}
                </span>
                <button
                  type="button"
                  onClick={() => handleDeleteMutation(m.id)}
                  title="Remove from queue"
                  className="shrink-0 rounded p-1 text-[var(--ink-muted)] hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
