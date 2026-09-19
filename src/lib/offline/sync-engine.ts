import { createClient } from "@/lib/supabase/client";
import {
  clearSyncedMeta,
  listPendingMutations,
  removeMutation,
  updateMutation,
  removeStockDeltasForMutation,
  enqueueMutation,
  type OfflineMutation,
  type OfflineMutationType,
} from "@/lib/offline/local-db";
import { isBusinessRuleError } from "@/lib/offline/offline-submit";

// ── Types ───────────────────────────────────────────────────────────

export type SyncResult = {
  success: number;
  failed: number;
  total: number;
  errors: { id: string; type: string; message: string }[];
  syncSessionId?: string;
};

export type SyncProgressCallback = (progress: {
  current: number;
  total: number;
  currentType: string;
  currentStatus: "syncing" | "success" | "failed";
}) => void;

// ── RPC mapping ─────────────────────────────────────────────────────

const RPC_MAP: Record<string, string> = {
  recovery: "record_recovery",
  sale_invoice: "create_sale_invoice",
  purchase_invoice: "create_purchase_invoice",
  sale_return: "create_sale_return",
  purchase_return: "create_purchase_return",
  cash_receipt: "create_cash_receipt",
  cash_payment: "create_cash_payment",
  journal_voucher: "create_journal_voucher",
  stock_transfer: "create_stock_transfer",
  gate_pass: "create_gate_pass",
  load_sheet: "create_load_sheet",
  expense: "create_expenses",
  expiry_receipt: "create_expiry_receipt",
  expiry_claim: "create_expiry_claim",
  expiry_settle: "settle_expiry_claim",
  salesman_invite: "create_salesman_invite",
};

/** Push stock-in and masters before stock-out documents. */
const SYNC_PRIORITY: Record<string, number> = {
  party_create: 1,
  party_update: 1,
  product_create: 1,
  product_update: 1,
  warehouse_create: 1,
  warehouse_update: 1,
  salesman_create: 1,
  salesman_update: 1,
  purchase_invoice: 10,
  purchase_return: 11,
  gate_pass: 12,
  stock_transfer: 20,
  load_sheet: 21,
  sale_invoice: 30,
  sale_return: 31,
  expiry_receipt: 32,
  expiry_claim: 33,
  expiry_settle: 34,
  recovery: 40,
  cash_receipt: 41,
  cash_payment: 42,
  journal_voucher: 43,
  expense: 44,
  salesman_invite: 2,
};

function sortMutationsForSync(list: OfflineMutation[]) {
  return [...list].sort((a, b) => {
    const pa = SYNC_PRIORITY[a.type] ?? 50;
    const pb = SYNC_PRIORITY[b.type] ?? 50;
    if (pa !== pb) return pa - pb;
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
}

// ── Push single mutation ────────────────────────────────────────────

async function pushOne(mutation: OfflineMutation): Promise<string | null> {
  const supabase = createClient();

  // ── Direct table operations ───────────────────────────────────
  if (mutation.type === "party_create") {
    const code = (mutation.payload.party_code as string | undefined)?.trim();
    if (code) {
      const { data: existing } = await supabase
        .from("parties")
        .select("id")
        .eq("company_id", mutation.companyId)
        .eq("party_code", code)
        .maybeSingle();
      if (existing?.id) return existing.id;
    }
    const { data, error } = await supabase
      .from("parties")
      .insert(mutation.payload)
      .select("id")
      .single();
    if (error) {
      if (code && (/duplicate|unique/i.test(error.message) || error.code === "23505")) {
        const { data: dup } = await supabase
          .from("parties")
          .select("id")
          .eq("company_id", mutation.companyId)
          .eq("party_code", code)
          .maybeSingle();
        if (dup?.id) return dup.id;
      }
      throw new Error(error.message);
    }
    return data.id;
  }

  if (mutation.type === "party_update") {
    const id = mutation.payload.id as string;
    const rest = { ...mutation.payload };
    delete rest.id;
    const { error } = await supabase.from("parties").update(rest).eq("id", id);
    if (error) throw new Error(error.message);
    return id;
  }

  if (mutation.type === "product_create") {
    const code = (mutation.payload.code as string | undefined)?.trim();
    if (code) {
      const { data: existing } = await supabase
        .from("products")
        .select("id")
        .eq("company_id", mutation.companyId)
        .eq("code", code)
        .maybeSingle();
      if (existing?.id) return existing.id;
    }
    const { data, error } = await supabase.rpc("create_product", {
      p_payload: mutation.payload,
    });
    if (error) {
      if (code && /duplicate|unique|already exists/i.test(error.message)) {
        const { data: dup } = await supabase
          .from("products")
          .select("id")
          .eq("company_id", mutation.companyId)
          .eq("code", code)
          .maybeSingle();
        if (dup?.id) return dup.id;
      }
      throw new Error(error.message);
    }
    return String(data);
  }

  if (mutation.type === "product_update") {
    const id =
      (mutation.payload.id as string | undefined) ||
      (mutation.payload.p_id as string | undefined);
    const rest = { ...mutation.payload };
    delete rest.id;
    delete rest.p_id;
    const { data, error } = await supabase.rpc("update_product", {
      p_id: id,
      p_payload: rest,
    });
    if (error) throw new Error(error.message);
    return String(data || id);
  }

  if (mutation.type === "warehouse_create") {
    const name = (mutation.payload.name as string | undefined)?.trim();
    if (name) {
      const { data: existing } = await supabase
        .from("warehouses")
        .select("id")
        .eq("company_id", mutation.companyId)
        .eq("name", name)
        .maybeSingle();
      if (existing?.id) return existing.id;
    }
    const { data, error } = await supabase
      .from("warehouses")
      .insert(mutation.payload)
      .select("id")
      .single();
    if (error) {
      if (name && (/duplicate|unique/i.test(error.message) || error.code === "23505")) {
        const { data: dup } = await supabase
          .from("warehouses")
          .select("id")
          .eq("company_id", mutation.companyId)
          .eq("name", name)
          .maybeSingle();
        if (dup?.id) return dup.id;
      }
      throw new Error(error.message);
    }
    return data.id;
  }

  if (mutation.type === "warehouse_update") {
    const id = mutation.payload.id as string;
    const rest = { ...mutation.payload };
    delete rest.id;
    const { error } = await supabase.from("warehouses").update(rest).eq("id", id);
    if (error) throw new Error(error.message);
    return id;
  }

  if (mutation.type === "salesman_create") {
    const name = (
      (mutation.payload.full_name || mutation.payload.name) as string | undefined
    )?.trim();
    if (name) {
      const { data: existing } = await supabase
        .from("salesmen")
        .select("id")
        .eq("company_id", mutation.companyId)
        .eq("full_name", name)
        .maybeSingle();
      if (existing?.id) return existing.id;
    }
    const { data, error } = await supabase
      .from("salesmen")
      .insert(mutation.payload)
      .select("id")
      .single();
    if (error) {
      if (name && (/duplicate|unique/i.test(error.message) || error.code === "23505")) {
        const { data: dup } = await supabase
          .from("salesmen")
          .select("id")
          .eq("company_id", mutation.companyId)
          .eq("full_name", name)
          .maybeSingle();
        if (dup?.id) return dup.id;
      }
      throw new Error(error.message);
    }
    return data.id;
  }

  if (mutation.type === "salesman_update") {
    const id = mutation.payload.id as string;
    const rest = { ...mutation.payload };
    delete rest.id;
    const { error } = await supabase.from("salesmen").update(rest).eq("id", id);
    if (error) throw new Error(error.message);
    return id;
  }

  // ── RPC-based operations ──────────────────────────────────────
  const rpcName = RPC_MAP[mutation.type];
  if (!rpcName) {
    throw new Error(`Unknown mutation type: ${mutation.type}`);
  }

  const { data, error } = await supabase.rpc(rpcName, {
    p_payload: mutation.payload,
  });
  if (error) throw new Error(error.message);
  return data ? String(data) : null;
}

// ── Main sync function ──────────────────────────────────────────────

let inFlightSync: Promise<SyncResult> | null = null;

export async function syncPendingMutations(params: {
  companyId: string;
  organizationId: string;
  onProgress?: SyncProgressCallback;
}): Promise<SyncResult> {
  if (inFlightSync) {
    return inFlightSync;
  }
  inFlightSync = (async () => {
    try {
      return await executeSyncPendingMutations(params);
    } finally {
      inFlightSync = null;
    }
  })();
  return inFlightSync;
}

async function executeSyncPendingMutations(params: {
  companyId: string;
  organizationId: string;
  onProgress?: SyncProgressCallback;
}): Promise<SyncResult> {
  const supabase = createClient();

  // Merge any pending SQLite outbox items into IndexedDB mutations
  try {
    const { hasLocalSqlite, localListOutbox } = await import("@/lib/offline/sqlite-client");
    if (hasLocalSqlite()) {
      const outbox = await localListOutbox(params.companyId, "pending", 500);
      const existingMutations = await listPendingMutations(params.companyId);
      const existingEntityIds = new Set(
        existingMutations.map((m) => String(m.localId || m.payload?.id || m.id)),
      );
      for (const item of outbox.rows || []) {
        const entityId = String(item.entity_id || item.id);
        if (!existingEntityIds.has(entityId)) {
          let payload: Record<string, unknown> = {};
          try {
            payload =
              typeof item.payload === "string"
                ? JSON.parse(item.payload)
                : (item.payload as Record<string, unknown>) || {};
          } catch {}
          await enqueueMutation({
            companyId: params.companyId,
            type: (item.entity_type || "sale_invoice") as OfflineMutationType,
            payload,
            localId: String(payload.invoice_no || payload.doc_no || entityId),
          });
          existingEntityIds.add(entityId);
        }
      }
    }
  } catch (err) {
    console.warn("[runSync] SQLite outbox merge check failed:", err);
  }

  const pending = sortMutationsForSync(
    await listPendingMutations(params.companyId),
  );

  if (pending.length === 0) {
    return { success: 0, failed: 0, total: 0, errors: [] };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  // Create a sync session
  const { data: session, error: sessionError } = await supabase
    .from("sync_sessions")
    .insert({
      organization_id: params.organizationId,
      company_id: params.companyId,
      user_id: user.id,
      status: "running",
      pending_count: pending.length,
    })
    .select("id")
    .single();

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  let success = 0;
  let failed = 0;
  const errors: { id: string; type: string; message: string }[] = [];

  for (let i = 0; i < pending.length; i++) {
    const mutation = pending[i];

    // Duplicate safeguard: if mutation was already assigned serverId in an interrupted sync, clean it up!
    if (mutation.serverId) {
      await removeMutation(mutation.id);
      await removeStockDeltasForMutation(mutation.id);
      try {
        const { hasLocalSqlite, localMarkEntitySynced } = await import(
          "@/lib/offline/sqlite-client"
        );
        if (hasLocalSqlite()) {
          await localMarkEntitySynced(mutation.type, String(mutation.serverId), "synced");
        }
      } catch {
        /* ignore */
      }
      success += 1;
      continue;
    }

    params.onProgress?.({
      current: i + 1,
      total: pending.length,
      currentType: mutation.type,
      currentStatus: "syncing",
    });

    await updateMutation(mutation.id, {
      status: "syncing",
      attempts: mutation.attempts + 1,
    });

    try {
      let serverId: string | null = null;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          serverId = await pushOne(mutation);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          // Business rejects will not succeed on retry in this session.
          if (isBusinessRuleError(msg)) break;
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          }
        }
      }
      if (lastErr) throw lastErr;

      // Update mutation with server ID before removing
      if (serverId) {
        await updateMutation(mutation.id, { serverId });
      }

      // Clean up: remove mutation and its stock deltas
      await removeMutation(mutation.id);
      await removeStockDeltasForMutation(mutation.id);

      // Mark matching SQLite ledger row as synced
      try {
        const { hasLocalSqlite, localMarkEntitySynced } = await import(
          "@/lib/offline/sqlite-client"
        );
        if (hasLocalSqlite()) {
          const entityId =
            serverId ||
            (typeof mutation.payload.id === "string"
              ? mutation.payload.id
              : mutation.localId) ||
            mutation.id;
          await localMarkEntitySynced(mutation.type, String(entityId), "synced");
        }
      } catch {
        /* ignore */
      }

      success += 1;

      params.onProgress?.({
        current: i + 1,
        total: pending.length,
        currentType: mutation.type,
        currentStatus: "success",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      await updateMutation(mutation.id, { status: "failed", error: message });
      failed += 1;
      errors.push({ id: mutation.id, type: mutation.type, message });

      params.onProgress?.({
        current: i + 1,
        total: pending.length,
        currentType: mutation.type,
        currentStatus: "failed",
      });
    }
  }

  // Update sync session
  const status =
    failed === 0 ? "success" : success === 0 ? "failed" : "partial";

  await supabase
    .from("sync_sessions")
    .update({
      status,
      success_count: success,
      failed_count: failed,
      finished_at: new Date().toISOString(),
      summary: { errors },
    })
    .eq("id", session.id);

  if (success > 0) {
    await clearSyncedMeta(params.companyId);
    try {
      const { refreshAllCaches } = await import("@/lib/offline/cache-manager");
      void refreshAllCaches(params.companyId);
    } catch {
      /* ignore */
    }
  }

  return {
    success,
    failed,
    total: pending.length,
    errors,
    syncSessionId: session.id,
  };
}

/**
 * Get a human-readable label for a mutation type.
 */
export function getMutationLabel(type: string): string {
  const labels: Record<string, string> = {
    recovery: "Recovery",
    sale_invoice: "Sale Invoice",
    purchase_invoice: "Purchase Invoice",
    sale_return: "Sale Return",
    purchase_return: "Purchase Return",
    cash_receipt: "Cash Receipt",
    cash_payment: "Cash Payment",
    journal_voucher: "Journal Voucher",
    stock_transfer: "Stock Transfer",
    gate_pass: "Gate Pass",
    load_sheet: "Load Sheet",
    expense: "Expense",
    party_create: "New Party",
    party_update: "Update Party",
    product_create: "New Product",
    product_update: "Update Product",
    warehouse_create: "New Warehouse",
    warehouse_update: "Warehouse Update",
    salesman_create: "Salesman",
    salesman_update: "Salesman Update",
    expiry_receipt: "Expiry Receipt",
    expiry_claim: "Expiry Claim",
    expiry_settle: "Expiry Settlement",
    salesman_invite: "Salesman Invite",
  };
  return labels[type] || type;
}
