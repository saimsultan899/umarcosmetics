"use client";

import { PartyCodeCell } from "@/components/forms/party-code-cell";
import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import { useSingleSubmit } from "@/lib/forms/single-submit";
import { offlineAwareSubmit } from "@/lib/offline/offline-submit";
import type { Party } from "@/lib/types/database";
import { BankPaymentFields } from "@/components/vouchers/bank-payment-fields";
import { AMOUNT_PLACEHOLDER, AMOUNT_STEP, formatPkr } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type Line = {
  key: string;
  party_id: string;
  amount: string;
  narration: string;
};

function emptyLine(): Line {
  return { key: crypto.randomUUID(), party_id: "", amount: "", narration: "" };
}

export type CashVoucherEdit = {
  id: string;
  voucherNo: string;
  date: string;
  narration: string;
  paymentMethod?: string;
  senderBank?: string;
  senderAccountName?: string;
  senderAccountNo?: string;
  receiverBank?: string;
  receiverAccountName?: string;
  receiverAccountNo?: string;
  warehouseId?: string | null;
  /** Header total — used for brand/company payments that have no voucher_lines. */
  totalAmount?: number;
  lines: { party_id: string; amount: string; narration: string }[];
};

function brandHeaderAmount(editing?: CashVoucherEdit) {
  const fromLines = (editing?.lines || []).reduce(
    (s, l) => s + Number(l.amount || 0),
    0,
  );
  if (fromLines > 0) return String(fromLines);
  const total = Number(editing?.totalAmount || 0);
  return total > 0 ? String(total) : "";
}

export function CashVoucherForm({
  kind,
  companyId,
  organizationId,
  parties,
  editing,
  onDone,
}: {
  kind: "CR" | "CP";
  companyId: string;
  organizationId: string;
  parties: Party[];
  editing?: CashVoucherEdit;
  onDone?: () => void;
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  // Company statement payments/incentives tag warehouse_id and often store the
  // amount only on vouchers.total_amount (no party lines).
  const isBrandPayment = kind === "CP" && Boolean(editing?.warehouseId);
  const [date, setDate] = useState(
    editing?.date || new Date().toISOString().slice(0, 10),
  );
  const [narration, setNarration] = useState(editing?.narration || "");
  const [paymentMethod, setPaymentMethod] = useState(
    editing?.paymentMethod || "cash",
  );
  const [senderBank, setSenderBank] = useState(editing?.senderBank || "");
  const [senderAccountName, setSenderAccountName] = useState(
    editing?.senderAccountName || "",
  );
  const [senderAccountNo, setSenderAccountNo] = useState(editing?.senderAccountNo || "");
  const [receiverBank, setReceiverBank] = useState(editing?.receiverBank || "");
  const [receiverAccountName, setReceiverAccountName] = useState(
    editing?.receiverAccountName || "",
  );
  const [receiverAccountNo, setReceiverAccountNo] = useState(
    editing?.receiverAccountNo || "",
  );
  const [brandAmount, setBrandAmount] = useState(() =>
    isBrandPayment ? brandHeaderAmount(editing) : "",
  );
  const [lines, setLines] = useState<Line[]>(
    editing?.lines.length
      ? editing.lines.map((line) => ({ key: crypto.randomUUID(), ...line }))
      : [emptyLine()],
  );
  const [loading, setLoading] = useState(false);
  const singleSubmit = useSingleSubmit();
  const [error, setError] = useState<string | null>(null);

  const lineTotal = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  const total = isBrandPayment ? Number(brandAmount || 0) : lineTotal;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await singleSubmit(async () => {
    setError(null);
    const valid = lines.filter((l) => l.party_id && Number(l.amount) > 0);
    if (isBrandPayment) {
      if (!(Number(brandAmount) > 0)) {
        setError(
          paymentMethod === "incentive"
            ? "Enter the incentive amount."
            : "Enter a payment amount.",
        );
        return;
      }
    } else if (valid.length === 0) {
      setError("Add at least one account line with amount.");
      return;
    }
    setLoading(true);
    try {
      const res = await offlineAwareSubmit({
        mutationType: editing
          ? kind === "CR"
            ? "cash_receipt_update"
            : "cash_payment_update"
          : kind === "CR"
            ? "cash_receipt"
            : "cash_payment",
        companyId,
        organizationId,
        payload: {
          ...(editing
            ? { voucher_id: editing.id, voucher_no: editing.voucherNo }
            : {}),
          organization_id: organizationId,
          company_id: companyId,
          voucher_date: date,
          narration,
          ...(kind === "CP"
            ? {
                payment_method: paymentMethod || "cash",
                sender_bank_name:
                  paymentMethod === "bank_transfer" ? senderBank.trim() : null,
                sender_account_name:
                  paymentMethod === "bank_transfer" ? senderAccountName.trim() : null,
                sender_account_no:
                  paymentMethod === "bank_transfer" ? senderAccountNo.trim() : null,
                receiver_bank_name:
                  paymentMethod === "bank_transfer" ? receiverBank.trim() : null,
                receiver_account_name:
                  paymentMethod === "bank_transfer" ? receiverAccountName.trim() : null,
                receiver_account_no:
                  paymentMethod === "bank_transfer" ? receiverAccountNo.trim() : null,
                warehouse_id: editing?.warehouseId || null,
                ...(isBrandPayment ? { amount: Number(brandAmount) } : {}),
              }
            : {}),
          lines: valid.map((l) => ({
            party_id: l.party_id,
            amount: Number(l.amount),
            narration: l.narration || null,
          })),
        },
      });

      setLoading(false);
      await Promise.resolve(onDone?.());
      closeDialog?.();
      const slug = kind === "CR" ? "cash-receipt" : "cash-payment";
      if (editing || res.source === "offline") {
        router.refresh();
      } else {
        router.push(`/vouchers/${slug}/${res.id}`);
        router.refresh();
      }
    } catch (err: any) {
      setLoading(false);
      setError(err?.message || String(err));
    }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        {kind === "CP" ? (
          <div>
            <Label>
              {paymentMethod === "incentive" ? "Type" : "Payment method"}
            </Label>
            <Select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              options={[
                { value: "cash", label: "Cash" },
                { value: "bank_transfer", label: "Bank transfer" },
                { value: "other", label: "Other" },
                ...(isBrandPayment || paymentMethod === "incentive"
                  ? [{ value: "incentive", label: "Incentive" }]
                  : []),
              ]}
            />
          </div>
        ) : null}
        {kind === "CP" && paymentMethod === "bank_transfer" ? (
          <div className="sm:col-span-2">
            <BankPaymentFields
              companyId={companyId}
              organizationId={organizationId}
              senderBank={senderBank}
              senderName={senderAccountName}
              senderNo={senderAccountNo}
              receiverBank={receiverBank}
              receiverName={receiverAccountName}
              receiverNo={receiverAccountNo}
              onSenderBank={setSenderBank}
              onSenderName={setSenderAccountName}
              onSenderNo={setSenderAccountNo}
              onReceiverBank={setReceiverBank}
              onReceiverName={setReceiverAccountName}
              onReceiverNo={setReceiverAccountNo}
            />
          </div>
        ) : null}
        {isBrandPayment ? (
          <div>
            <Label>
              {paymentMethod === "incentive" ? "Incentive amount" : "Amount"}
            </Label>
            <Input
              type="number"
              min="0"
              step={AMOUNT_STEP}
              placeholder={AMOUNT_PLACEHOLDER}
              value={brandAmount}
              onChange={(e) => setBrandAmount(e.target.value)}
              required
            />
          </div>
        ) : null}
        <div className={kind === "CP" ? "sm:col-span-2" : undefined}>
          <Label>Narration</Label>
          <Input value={narration} onChange={(e) => setNarration(e.target.value)} />
        </div>
      </div>

      {isBrandPayment ? (
        <p className="text-sm text-[var(--muted)]">
          Company statement {paymentMethod === "incentive" ? "incentive" : "payment"}{" "}
          · total {formatPkr(total)}.
          {editing?.voucherNo ? ` Voucher ${editing.voucherNo}.` : ""}
        </p>
      ) : (
        <>
          <div className="table-grid">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="bg-[var(--surface-2)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-3 py-2">
                    {kind === "CR" ? "Customer" : "Account"}
                  </th>
                  <th className="px-3 py-2 w-36">Amount</th>
                  <th className="px-3 py-2">Narration</th>
                  <th className="px-3 py-2 w-12" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2">
                      <PartyCodeCell
                        companyId={companyId}
                        parties={parties}
                        value={line.party_id}
                        onChange={(partyId) =>
                          setLines((prev) =>
                            prev.map((l) =>
                              l.key === line.key ? { ...l, party_id: partyId } : l,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min="0"
                        step={AMOUNT_STEP}
                        placeholder={AMOUNT_PLACEHOLDER}
                        value={line.amount}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l) =>
                              l.key === line.key
                                ? { ...l, amount: e.target.value }
                                : l,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={line.narration}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l) =>
                              l.key === line.key
                                ? { ...l, narration: e.target.value }
                                : l,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="rounded-lg p-2 text-rose-600 hover:bg-rose-50"
                        onClick={() =>
                          setLines((prev) =>
                            prev.length <= 1
                              ? [emptyLine()]
                              : prev.filter((l) => l.key !== line.key),
                          )
                        }
                        aria-label="Remove line"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setLines((p) => [...p, emptyLine()])}
            >
              <Plus className="h-4 w-4" />
              Add line
            </Button>
            <p className="text-sm">
              <span className="font-semibold">
                {lines.filter((l) => l.party_id && Number(l.amount) > 0).length}{" "}
                {kind === "CR" ? "customers" : "vendors"}
              </span>
              <span className="ml-3 font-semibold">Total {formatPkr(total)}</span>
            </p>
          </div>
        </>
      )}

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <Button type="submit" loading={loading}>
        {loading
          ? editing
            ? "Updating..."
            : "Posting..."
          : editing
            ? kind === "CR"
              ? "Update cash receipt"
              : isBrandPayment
                ? paymentMethod === "incentive"
                  ? "Update incentive"
                  : "Update company payment"
                : "Update cash payment"
            : kind === "CR"
              ? "Save cash receipt"
              : "Save cash payment"}
      </Button>
    </form>
  );
}
