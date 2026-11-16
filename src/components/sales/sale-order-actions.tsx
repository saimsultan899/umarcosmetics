"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

function newRequestId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isTransientNetwork(err: unknown) {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "";
  return /failed to fetch|networkerror|network request failed|load failed|internet|offline|timeout|abort|fetch failed|connection|502|503|520|522|524/i.test(
    raw,
  );
}

function networkMessage(err: unknown) {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Could not complete this action";
  if (isTransientNetwork(err)) {
    return "Office connection dropped while billing this company. Keep this page open and press Fulfil again — the same bill will not post twice.";
  }
  return (
    raw
      .replace(/^Could not bill [^:]+:\s*/i, "")
      .replace(/salesman device|device internet/gi, "connection")
      .trim() || raw
  );
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fulfillOnce(
  orderId: string,
  warehouseId: string,
  clientRequestId: string,
) {
  const { data, error: rpcError } = await createClient().rpc(
    "fulfill_sale_order_company",
    {
      p_order_id: orderId,
      p_warehouse_id: warehouseId,
      p_client_request_id: clientRequestId,
    },
  );
  if (rpcError) throw new Error(rpcError.message);
  return typeof data === "string" ? data : null;
}

function storedRequestId(orderId: string, warehouseId: string) {
  const key = `sale-order-fulfil:${orderId}:${warehouseId}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = newRequestId();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return newRequestId();
  }
}

function clearRequestId(orderId: string, warehouseId: string) {
  try {
    sessionStorage.removeItem(`sale-order-fulfil:${orderId}:${warehouseId}`);
  } catch {
    // Ignore private-mode storage.
  }
}

export function FulfilOrderButton({
  orderId,
  warehouseIds,
  customerName,
  onDone,
}: {
  orderId: string;
  warehouseIds: string[];
  customerName?: string;
  onDone?: (invoiceIds: string[]) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fulfil() {
    const waiting = [...new Set(warehouseIds.filter(Boolean))];
    if (!waiting.length) return;
    const who = customerName ? ` for ${customerName}` : "";
    if (
      !window.confirm(
        `Fulfil this order${who}?\n\nYou have already viewed the lines. This posts the credit sale and moves stock.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const invoiceIds: string[] = [];
    try {
      for (const warehouseId of waiting) {
        const requestId = storedRequestId(orderId, warehouseId);
        let invoiceId: string | null = null;
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            invoiceId = await fulfillOnce(orderId, warehouseId, requestId);
            lastError = null;
            break;
          } catch (err) {
            lastError = err;
            if (!isTransientNetwork(err) || attempt === 2) break;
            await sleep(700 * (attempt + 1));
          }
        }
        if (lastError) throw lastError;
        clearRequestId(orderId, warehouseId);
        if (invoiceId) invoiceIds.push(invoiceId);
      }
      onDone?.(invoiceIds);
      router.refresh();
    } catch (err) {
      setError(networkMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy || warehouseIds.length === 0}
        onClick={() => void fulfil()}
        className="inline-flex h-9 items-center rounded-[var(--radius-sm)] bg-[var(--brand)] px-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Billing…" : "Fulfil order"}
      </button>
      {error ? <p className="max-w-xs text-right text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

export function CancelOrderButton({
  orderId,
  partial = false,
}: {
  orderId: string;
  partial?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    const ok = window.confirm(
      partial
        ? "Cancel the companies still waiting? Bills already posted stay."
        : "Delete this salesman order? Nothing has been billed yet.",
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await createClient().rpc("cancel_sale_order", {
        p_order_id: orderId,
      });
      if (rpcError) throw new Error(rpcError.message);
      router.refresh();
      if (!partial) router.push("/sales/orders");
    } catch (err) {
      setError(networkMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void cancel()}
        className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-white px-3 text-sm font-medium disabled:opacity-50"
      >
        {busy
          ? "Working…"
          : partial
            ? "Cancel remaining"
            : "Delete order"}
      </button>
      {error ? <p className="max-w-xs text-right text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
