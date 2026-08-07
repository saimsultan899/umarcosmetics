import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type OfflineMutationType = "recovery" | "sale_invoice";

export type OfflineMutation = {
  id: string;
  companyId: string;
  type: OfflineMutationType;
  payload: Record<string, unknown>;
  createdAt: string;
  status: "pending" | "syncing" | "failed";
  error?: string;
  attempts: number;
};

interface UmarOfflineDB extends DBSchema {
  mutations: {
    key: string;
    value: OfflineMutation;
    indexes: { "by-company-status": [string, string] };
  };
  meta: {
    key: string;
    value: { key: string; value: unknown };
  };
}

let dbPromise: Promise<IDBPDatabase<UmarOfflineDB>> | null = null;

function getDb() {
  if (typeof window === "undefined") {
    throw new Error("Offline DB is browser-only");
  }
  if (!dbPromise) {
    dbPromise = openDB<UmarOfflineDB>("umar-offline", 1, {
      upgrade(db) {
        const store = db.createObjectStore("mutations", { keyPath: "id" });
        store.createIndex("by-company-status", ["companyId", "status"]);
        db.createObjectStore("meta", { keyPath: "key" });
      },
    });
  }
  return dbPromise;
}

export async function enqueueMutation(
  input: Omit<OfflineMutation, "id" | "createdAt" | "status" | "attempts">,
) {
  const db = await getDb();
  const row: OfflineMutation = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "pending",
    attempts: 0,
  };
  await db.put("mutations", row);
  return row;
}

export async function listPendingMutations(companyId: string) {
  const db = await getDb();
  const all = await db.getAll("mutations");
  return all
    .filter((m) => m.companyId === companyId && (m.status === "pending" || m.status === "failed"))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function countPendingMutations(companyId: string) {
  const pending = await listPendingMutations(companyId);
  return pending.length;
}

export async function updateMutation(id: string, patch: Partial<OfflineMutation>) {
  const db = await getDb();
  const current = await db.get("mutations", id);
  if (!current) return;
  await db.put("mutations", { ...current, ...patch });
}

export async function removeMutation(id: string) {
  const db = await getDb();
  await db.delete("mutations", id);
}

export async function clearSyncedMeta(companyId: string) {
  const db = await getDb();
  await db.put("meta", {
    key: `last-sync:${companyId}`,
    value: new Date().toISOString(),
  });
}

export async function getLastSync(companyId: string) {
  const db = await getDb();
  const row = await db.get("meta", `last-sync:${companyId}`);
  return (row?.value as string) || null;
}
