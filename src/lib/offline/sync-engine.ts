import { createClient } from "@/lib/supabase/client";
import {
  clearSyncedMeta,
  listPendingMutations,
  removeMutation,
  updateMutation,
  type OfflineMutation,
} from "@/lib/offline/db";

export type SyncResult = {
  success: number;
  failed: number;
  errors: { id: string; message: string }[];
  syncSessionId?: string;
};

async function pushOne(mutation: OfflineMutation) {
  const supabase = createClient();

  if (mutation.type === "recovery") {
    const { error } = await supabase.rpc("record_recovery", {
      p_payload: mutation.payload,
    });
    if (error) throw new Error(error.message);
    return;
  }

  if (mutation.type === "sale_invoice") {
    const { error } = await supabase.rpc("create_sale_invoice", {
      p_payload: mutation.payload,
    });
    if (error) throw new Error(error.message);
    return;
  }

  throw new Error(`Unknown mutation type: ${mutation.type}`);
}

export async function syncPendingMutations(params: {
  companyId: string;
  organizationId: string;
}): Promise<SyncResult> {
  const supabase = createClient();
  const pending = await listPendingMutations(params.companyId);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

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
  const errors: { id: string; message: string }[] = [];

  for (const mutation of pending) {
    await updateMutation(mutation.id, {
      status: "syncing",
      attempts: mutation.attempts + 1,
    });

    try {
      await pushOne(mutation);
      await removeMutation(mutation.id);
      success += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      await updateMutation(mutation.id, { status: "failed", error: message });
      failed += 1;
      errors.push({ id: mutation.id, message });
    }
  }

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
  }

  return {
    success,
    failed,
    errors,
    syncSessionId: session.id,
  };
}
