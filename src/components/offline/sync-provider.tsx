"use client";

import { countPendingMutations } from "@/lib/offline/db";
import { syncPendingMutations } from "@/lib/offline/sync-engine";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type SyncContextValue = {
  online: boolean;
  pending: number;
  syncing: boolean;
  lastMessage: string | null;
  refreshPending: () => Promise<void>;
  runSync: () => Promise<void>;
};

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({
  companyId,
  organizationId,
  children,
}: {
  companyId?: string | null;
  organizationId?: string | null;
  children: React.ReactNode;
}) {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const refreshPending = useCallback(async () => {
    if (!companyId) {
      setPending(0);
      return;
    }
    try {
      const count = await countPendingMutations(companyId);
      setPending(count);
    } catch {
      setPending(0);
    }
  }, [companyId]);

  const runSync = useCallback(async () => {
    if (!companyId || !organizationId || syncing) return;
    setSyncing(true);
    setLastMessage("Syncing pending records...");
    try {
      const result = await syncPendingMutations({ companyId, organizationId });
      setLastMessage(
        `Synced ${result.success} · Failed ${result.failed}`,
      );
      await refreshPending();
    } catch (err) {
      setLastMessage(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [companyId, organizationId, refreshPending, syncing]);

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

  useEffect(() => {
    void refreshPending();
    const timer = window.setInterval(() => void refreshPending(), 15000);
    return () => window.clearInterval(timer);
  }, [refreshPending]);

  useEffect(() => {
    if (online && pending > 0) {
      // Auto-sync lightly when connection returns
      void runSync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const value = useMemo(
    () => ({ online, pending, syncing, lastMessage, refreshPending, runSync }),
    [online, pending, syncing, lastMessage, refreshPending, runSync],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSyncStatus() {
  const ctx = useContext(SyncContext);
  if (!ctx) {
    return {
      online: true,
      pending: 0,
      syncing: false,
      lastMessage: null,
      refreshPending: async () => {},
      runSync: async () => {},
    };
  }
  return ctx;
}
