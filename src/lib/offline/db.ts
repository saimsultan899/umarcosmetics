/**
 * Legacy re-exports from the expanded offline DB.
 *
 * All new code should import from "@/lib/offline/local-db" directly.
 * This file exists for backward-compatibility with existing components
 * (e.g. field-recovery-form, field-sale-form) that import from "@/lib/offline/db".
 */
export {
  enqueueMutation,
  listPendingMutations,
  countPendingMutations,
  updateMutation,
  removeMutation,
  clearSyncedMeta,
  getLastSync,
  type OfflineMutation,
  type OfflineMutationType,
} from "@/lib/offline/local-db";
