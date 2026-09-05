"use client";

import { PartyCodePicker } from "@/components/forms/party-code-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import { createClient } from "@/lib/supabase/client";
import type { Party, Warehouse } from "@/lib/types/database";
import type { ExpiryStockRow } from "@/lib/queries/expiry";
import { formatNumber, formatPkr } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

export function ExpiryClaimForm({
  companyId,
  organizationId,
  parties,
  warehouses,
  stock,
}: {
  companyId: string;
  organizationId: string;
  parties: Party[];
  warehouses: Warehouse[];
  stock: ExpiryStockRow[];
}) {
  const router = useRouter();
  const vendors = useMemo(
    () =>
      parties.filter(
        (p) =>
          p.party_subtype === "supplier" ||
          p.party_subtype === "both" ||
          p.party_type === "PARTY",
      ),
    [parties],
  );

  const [partyId, setPartyId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [claimDate, setClaimDate] = useState(new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [qtyByProduct, setQtyByProduct] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendLines = stock
    .map((row) => {
      const qty = Math.min(Number(qtyByProduct[row.product_id] || 0), row.qty);
      return {
        ...row,
        sendQty: qty,
        sendAmount: Math.round(qty * row.rate * 100) / 100,
      };
    })
    .filter((row) => row.sendQty > 0);

  const grandTotal = sendLines.reduce((s, l) => s + l.sendAmount, 0);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!partyId || sendLines.length === 0) {
      setError("Select a vendor and enter qty to send from expiry stock.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_expiry_claim", {
      p_payload: {
        organization_id: organizationId,
        company_id: companyId,
        claim_date: claimDate,
        party_id: partyId,
        warehouse_id: warehouseId || null,
        grand_total: grandTotal,
        narration,
        items: sendLines.map((l) => ({
          product_id: l.product_id,
          product_code: l.product_code,
          product_name: l.product_name,
          qty: l.sendQty,
          rate: l.rate,
          amount: l.sendAmount,
        })),
      },
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.push(`/inventory/expiry/claims/${data}`);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Date</Label>
          <Input
            type="date"
            value={claimDate}
            onChange={(e) => setClaimDate(e.target.value)}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <PartyCodePicker
            companyId={companyId}
            parties={vendors}
            value={partyId}
            required
            label="Vendor"
            emptyLabel="Select vendor"
            filterSubtype={["supplier", "both"]}
            onChange={(id) => setPartyId(id)}
          />
        </div>
        <div>
          <Label>Brand / company</Label>
          <Select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            options={[
              { value: "", label: "Optional" },
              ...warehouses.map((w) => ({ value: w.id, label: w.name })),
            ]}
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <Label>Narration</Label>
          <Input
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder="Expired stock sent to manufacturer"
          />
        </div>
      </div>

      <div className="table-grid table-grid--y-scroll">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr>
              <th>Item</th>
              <th className="w-28">On hand</th>
              <th className="w-28">Rate</th>
              <th className="w-32">Send qty</th>
              <th className="w-32">Amount</th>
            </tr>
          </thead>
          <tbody>
            {stock.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-[var(--muted)]">
                  No expiry stock on hand. Receive expired goods from a customer first.
                </td>
              </tr>
            ) : (
              stock.map((row) => {
                const qty = Number(qtyByProduct[row.product_id] || 0);
                const amount = Math.round(Math.min(qty, row.qty) * row.rate * 100) / 100;
                return (
                  <tr key={row.product_id}>
                    <td className="px-3 py-2">
                      {row.product_code} {row.product_name}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatNumber(row.qty, 2)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatNumber(row.rate, 2)}
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="number"
                        min="0"
                        max={row.qty}
                        step="0.001"
                        value={qtyByProduct[row.product_id] ?? ""}
                        onChange={(e) =>
                          setQtyByProduct((prev) => ({
                            ...prev,
                            [row.product_id]: e.target.value,
                          }))
                        }
                      />
                    </td>
                    <td className="px-3 py-2 tabular-nums">{formatPkr(amount)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end text-sm font-semibold">
        Claim amount {formatPkr(grandTotal)}
      </div>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <Button type="submit" disabled={loading || stock.length === 0}>
        {loading ? "Posting..." : "Send to vendor"}
      </Button>
    </form>
  );
}
