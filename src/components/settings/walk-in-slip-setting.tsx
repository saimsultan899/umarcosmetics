"use client";

import {
  useWalkInSlip,
  writeWalkInSlip,
} from "@/lib/print/walk-in-slip";

export function WalkInSlipSetting({ companyId }: { companyId: string }) {
  const layout = useWalkInSlip(companyId);

  return (
    <div className="panel p-5">
      <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
        Walk-in receipt
      </h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Counter sales with no ledger. This choice is remembered on this
        computer, so each walk-in sale uses it without asking again. Ledger
        customers stay on the standard invoice.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] p-3">
          <input
            type="radio"
            name="walk-in-slip"
            className="mt-1"
            checked={layout === "standard"}
            onChange={() => writeWalkInSlip(companyId, "standard")}
          />
          <span>
            <span className="block text-sm font-semibold">Standard invoice</span>
            <span className="mt-0.5 block text-xs text-[var(--muted)]">
              Half A4 bill, same as shop accounts.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] p-3">
          <input
            type="radio"
            name="walk-in-slip"
            className="mt-1"
            checked={layout === "thermal"}
            onChange={() => writeWalkInSlip(companyId, "thermal")}
          />
          <span>
            <span className="block text-sm font-semibold">80mm thermal slip</span>
            <span className="mt-0.5 block text-xs text-[var(--muted)]">
              Short cash receipt. Printed in solid black with space for the cutter.
            </span>
          </span>
        </label>
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">
        On the printer, choose the 80mm roll, turn on background graphics, and
        enable cut after each job (partial cut GS V 1 or full cut GS V 0 — not
        GS V 66, which feeds extra paper). The standard invoice stays on the
        bill if you need it.
      </p>
    </div>
  );
}
