"use client";

import {
  listPendingMutations,
  getLastSync,
} from "@/lib/offline/local-db";
import {
  syncPendingMutations,
  getMutationLabel,
  type SyncResult,
} from "@/lib/offline/sync-engine";
import {
  autoRefreshStaleCaches,
  cacheSessionData,
  getCachedSessionData,
  refreshAllCaches,
} from "@/lib/offline/cache-manager";
import {
  hasOfflineSessionCookie,
  setOfflineSessionCookie,
} from "@/lib/offline/local-auth";
import {
  buildOfflineShellSnapshot,
  readOfflineShellCookie,
  writeOfflineShellCookie,
} from "@/lib/offline/offline-shell";
import { setupServiceWorker } from "@/lib/offline/service-worker";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// ── Types ───────────────────────────────────────────────────────────

type SyncProgress = {
  current: number;
  total: number;
  currentType: string;
  currentStatus: "syncing" | "success" | "failed";
};

type PendingSummary = {
  total: number;
  byType: Record<string, number>;
};

type SyncContextValue = {
  online: boolean;
  companyId: string | null;
  pending: PendingSummary;
  syncing: boolean;
  syncProgress: SyncProgress | null;
  lastSync: string | null;
  lastResult: SyncResult | null;
  lastMessage: string | null;
  refreshPending: () => Promise<void>;
  runSync: () => Promise<SyncResult | null>;
};

const SyncContext = createContext<SyncContextValue | null>(null);

// ── Provider ────────────────────────────────────────────────────────

export function SyncProvider({
  companyId,
  organizationId,
  userName,
  profileData,
  companyData,
  membershipsData,
  children,
}: {
  companyId?: string | null;
  organizationId?: string | null;
  userName?: string | null;
  profileData?: Record<string, unknown> | null;
  companyData?: Record<string, unknown> | null;
  membershipsData?: Record<string, unknown>[] | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const activatingOffline = useRef(false);
  const [online, setOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [pending, setPending] = useState<PendingSummary>({
    total: 0,
    byType: {},
  });
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const persistShellCookie = useCallback(() => {
    const snapshot = buildOfflineShellSnapshot({
      userId: String((profileData as { id?: string } | null)?.id || ""),
      email: null,
      fullName: userName,
      profile: profileData,
      company: companyData,
      memberships: membershipsData,
    });
    if (snapshot) writeOfflineShellCookie(snapshot);
    return snapshot;
  }, [profileData, companyData, membershipsData, userName]);

  const activateOfflineMode = useCallback(async () => {
    if (activatingOffline.current) return;
    activatingOffline.current = true;
    try {
      let snapshot = persistShellCookie();
      if (!snapshot) {
        snapshot = readOfflineShellCookie();
      }
      if (!snapshot) {
        const cached = await getCachedSessionData();
        if (cached) {
          snapshot = buildOfflineShellSnapshot({
            userId: cached.userId,
            profile: cached.profile,
            company: cached.company,
            memberships: cached.memberships,
          });
          if (snapshot) writeOfflineShellCookie(snapshot);
        }
      }
      setOfflineSessionCookie(true);
      router.refresh();
    } finally {
      window.setTimeout(() => {
        activatingOffline.current = false;
      }, 1500);
    }
  }, [persistShellCookie, router]);

  // ── Refresh pending count ──────────────────────────────────────
  const refreshPending = useCallback(async () => {
    if (!companyId) {
      setPending({ total: 0, byType: {} });
      return;
    }
    try {
      const mutations = await listPendingMutations(companyId);
      const byType: Record<string, number> = {};
      for (const m of mutations) {
        byType[m.type] = (byType[m.type] || 0) + 1;
      }
      setPending({ total: mutations.length, byType });
    } catch {
      setPending({ total: 0, byType: {} });
    }
  }, [companyId]);

  // ── Run full sync ──────────────────────────────────────────────
  const runSync = useCallback(async (): Promise<SyncResult | null> => {
    if (!companyId || !organizationId || syncing) return null;
    setSyncing(true);
    setSyncProgress(null);
    setLastMessage("Starting sync…");

    try {
      const result = await syncPendingMutations({
        companyId,
        organizationId,
        onProgress: (p) => {
          setSyncProgress(p);
          setLastMessage(
            `Syncing ${getMutationLabel(p.currentType)} (${p.current}/${p.total})…`,
          );
        },
      });

      setLastResult(result);
      setLastMessage(
        result.failed === 0
          ? `✓ Synced ${result.success} record${result.success !== 1 ? "s" : ""}`
          : `Synced ${result.success} · Failed ${result.failed}`,
      );

      // Refresh cache after successful sync
      if (result.success > 0) {
        void autoRefreshStaleCaches(companyId);
      }

      await refreshPending();

      // Update last sync time
      const ls = await getLastSync(companyId);
      setLastSync(ls);

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sync failed";
      setLastMessage(`✗ ${msg}`);
      return null;
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  }, [companyId, organizationId, refreshPending, syncing]);

  // ── Online/offline detection ───────────────────────────────────
  useEffect(() => {
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // ── Periodic pending refresh ───────────────────────────────────
  useEffect(() => {
    void refreshPending();
    const timer = window.setInterval(() => void refreshPending(), 15000);
    return () => window.clearInterval(timer);
  }, [refreshPending]);

  // ── Load last sync time ────────────────────────────────────────
  useEffect(() => {
    if (companyId) {
      void getLastSync(companyId).then(setLastSync);
    }
  }, [companyId]);

  // ── Auto-sync + full snapshot when coming online ───────────────
  useEffect(() => {
    if (online) {
      setOfflineSessionCookie(false);
      if (companyId) {
        void refreshAllCaches(companyId);
      }
      if (pending.total > 0) {
        void runSync();
      }
      return;
    }
    // Mid-session disconnect: flip server into offline shell path so
    // RSC pages stop hanging on Supabase and render local UI.
    // Skip if cookie already set to avoid refresh loops.
    if (!hasOfflineSessionCookie()) {
      void activateOfflineMode();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // ── Auto-refresh caches when online ────────────────────────────
  useEffect(() => {
    if (online && companyId) {
      void autoRefreshStaleCaches(companyId);
    }
  }, [online, companyId]);

  // ── Cache session data + keep shell cookie warm for disconnect ─
  useEffect(() => {
    if (profileData && companyId) {
      void cacheSessionData({
        userId: (profileData as { id?: string })?.id || "",
        profile: profileData as Record<string, unknown>,
        company: companyData as Record<string, unknown> | null,
        memberships: membershipsData || [],
      });
      persistShellCookie();
    }
  }, [
    profileData,
    companyData,
    companyId,
    membershipsData,
    persistShellCookie,
  ]);

  // ── Service worker (browser PWA only; disabled in Electron) ────
  useEffect(() => {
    void setupServiceWorker();
  }, []);

  const value = useMemo(
    () => ({
      online,
      companyId: companyId || null,
      pending,
      syncing,
      syncProgress,
      lastSync,
      lastResult,
      lastMessage,
      refreshPending,
      runSync,
    }),
    [
      online,
      companyId,
      pending,
      syncing,
      syncProgress,
      lastSync,
      lastResult,
      lastMessage,
      refreshPending,
      runSync,
    ],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

// ── Hook ────────────────────────────────────────────────────────────

export function useSyncStatus() {
  const ctx = useContext(SyncContext);
  if (!ctx) {
    return {
      online: typeof navigator !== "undefined" ? navigator.onLine : true,
      companyId: null as string | null,
      pending: { total: 0, byType: {} } as PendingSummary,
      syncing: false,
      syncProgress: null as SyncProgress | null,
      lastSync: null as string | null,
      lastResult: null as SyncResult | null,
      lastMessage: null as string | null,
      refreshPending: async () => {},
      runSync: async () => null as SyncResult | null,
    };
  }
  return ctx;
}
