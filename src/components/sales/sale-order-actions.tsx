"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function FulfilCompanyButton({
  orderId,
  warehouseId,
}: {
  orderId: string;
  warehouseId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fulfil() {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await createClient().rpc(
      "fulfill_sale_order_company",
      { p_order_id: orderId, p_warehouse_id: warehouseId },
    );
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void fulfil()}
        className="inline-flex h-9 items-center rounded-lg bg-[var(--brand)] px-3 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Billing…" : "Fulfil"}
      </button>
      {error ? <p className="max-w-xs text-right text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

export function CancelOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!window.confirm("Cancel this order? Nothing has been billed.")) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await createClient().rpc("cancel_sale_order", {
      p_order_id: orderId,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void cancel()}
        className="inline-flex h-9 items-center rounded-lg border border-[var(--border)] bg-white px-3 text-sm font-medium disabled:opacity-50"
      >
        {busy ? "Cancelling…" : "Cancel order"}
      </button>
      {error ? <p className="max-w-xs text-right text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
