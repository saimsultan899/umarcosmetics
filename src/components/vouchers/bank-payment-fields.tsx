"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_PAYMENT_BANKS } from "@/lib/vouchers/pakistan-banks";
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, ListOrdered, Trash2 } from "lucide-react";
import { useState, useEffect } from "react";

type BankRow = {
  id: string;
  name: string;
  originalName: string;
};

function moveItem<T>(list: T[], from: number, to: number) {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function PartyBankBlock({
  title,
  banks,
  bank,
  name,
  accountNo,
  onBank,
  onName,
  onAccountNo,
  collapsible = false,
}: {
  title: string;
  banks: string[];
  bank: string;
  name: string;
  accountNo: string;
  onBank: (value: string) => void;
  onName: (value: string) => void;
  onAccountNo: (value: string) => void;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const options = [
    { value: "", label: "Select bank" },
    ...banks.map((item) => ({ value: item, label: item })),
  ];
  if (bank && !banks.includes(bank)) {
    options.splice(1, 0, { value: bank, label: bank });
  }

  const summary = [bank, name, accountNo].filter(Boolean).join(" · ");
  const fields = (
    <div className="space-y-2.5">
      <div>
        <Label>Bank</Label>
        <Select
          value={bank}
          onChange={(e) => onBank(e.target.value)}
          options={options}
        />
      </div>
      <div>
        <Label>Name</Label>
        <Input
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder={`${title} name (optional)`}
        />
      </div>
      <div>
        <Label>Account no.</Label>
        <Input
          value={accountNo}
          onChange={(e) => onAccountNo(e.target.value)}
          placeholder="Account number (optional)"
        />
      </div>
    </div>
  );

  if (!collapsible) {
    return (
      <div className="min-w-0 space-y-2 rounded-lg border border-[var(--border)] p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          {title}
        </p>
        {fields}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)]">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            {title}
          </span>
          <span className="mt-0.5 block truncate text-sm text-[var(--ink)]">
            {summary || "Optional — click to add bank details"}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[var(--muted)] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open ? <div className="space-y-3 border-t border-[var(--border)] px-3 py-3">{fields}</div> : null}
    </div>
  );
}

export function BankPaymentFields({
  companyId,
  organizationId,
  senderBank,
  senderName,
  senderNo,
  receiverBank,
  receiverName,
  receiverNo,
  onSenderBank,
  onSenderName,
  onSenderNo,
  onReceiverBank,
  onReceiverName,
  onReceiverNo,
  collapsible = false,
}: {
  companyId: string;
  organizationId: string;
  senderBank: string;
  senderName: string;
  senderNo: string;
  receiverBank: string;
  receiverName: string;
  receiverNo: string;
  onSenderBank: (value: string) => void;
  onSenderName: (value: string) => void;
  onSenderNo: (value: string) => void;
  onReceiverBank: (value: string) => void;
  onReceiverName: (value: string) => void;
  onReceiverNo: (value: string) => void;
  /** Sender and receiver stay closed until clicked. */
  collapsible?: boolean;
}) {
  const [banks, setBanks] = useState<BankRow[]>([]);
  const [arrangeOpen, setArrangeOpen] = useState(false);

  async function loadBanks() {
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("ensure_company_banks", {
        p_company_id: companyId,
      });
      if (error) throw new Error(error.message);
      const rows = ((data || []) as Array<{ id: string; name: string }>).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        originalName: String(row.name),
      }));
      if (rows.length) {
        setBanks(rows);
        return;
      }
    } catch {
      // Fall back to the built-in list when the bank table cannot be read.
    }
    setBanks(
      DEFAULT_PAYMENT_BANKS.map((name, index) => ({
        id: `local-${index}`,
        name,
        originalName: name,
      })),
    );
  }

  useEffect(() => {
    void loadBanks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const names = banks.map((bank) => bank.name).filter(Boolean);

  function applyRename(from: string, to: string) {
    if (!from || from === to) return;
    if (senderBank === from) onSenderBank(to);
    if (receiverBank === from) onReceiverBank(to);
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setArrangeOpen(true)}
        >
          <ListOrdered className="h-4 w-4" />
          Arrange banks
        </Button>
      </div>
      <div
        className={
          collapsible
            ? "space-y-3"
            : "grid gap-3 md:grid-cols-2"
        }
      >
        <PartyBankBlock
          title="Sender"
          banks={names}
          bank={senderBank}
          name={senderName}
          accountNo={senderNo}
          onBank={onSenderBank}
          onName={onSenderName}
          onAccountNo={onSenderNo}
          collapsible={collapsible}
        />
        <PartyBankBlock
          title="Receiver"
          banks={names}
          bank={receiverBank}
          name={receiverName}
          accountNo={receiverNo}
          onBank={onReceiverBank}
          onName={onReceiverName}
          onAccountNo={onReceiverNo}
          collapsible={collapsible}
        />
      </div>
      <ArrangeBanksDialog
        open={arrangeOpen}
        onClose={() => setArrangeOpen(false)}
        companyId={companyId}
        organizationId={organizationId}
        initial={banks}
        onSaved={(next, renamed) => {
          setBanks(next);
          for (const change of renamed) applyRename(change.from, change.to);
          setArrangeOpen(false);
        }}
      />
    </div>
  );
}

function ArrangeBanksDialog({
  open,
  onClose,
  companyId,
  organizationId,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  organizationId: string;
  initial: BankRow[];
  onSaved: (rows: BankRow[], renamed: Array<{ from: string; to: string }>) => void;
}) {
  const [rows, setRows] = useState<BankRow[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRows(initial.map((row) => ({ ...row })));
    setRemoved([]);
    setNewName("");
    setError(null);
  }, [open, initial]);

  function addBank() {
    const name = newName.trim();
    if (!name) return;
    if (rows.some((row) => row.name.trim().toLowerCase() === name.toLowerCase())) {
      setError("That bank is already in the list.");
      return;
    }
    setRows((prev) => [
      { id: `new-${crypto.randomUUID()}`, name, originalName: "" },
      ...prev,
    ]);
    setNewName("");
    setError(null);
  }

  async function save() {
    const cleaned = rows
      .map((row) => ({ ...row, name: row.name.trim() }))
      .filter((row) => row.name);
    const seen = new Set<string>();
    for (const row of cleaned) {
      const key = row.name.toLowerCase();
      if (seen.has(key)) {
        setError(`“${row.name}” is listed twice.`);
        return;
      }
      seen.add(key);
    }
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const persisted = cleaned.filter((row) => !row.id.startsWith("local-"));
      for (const id of removed) {
        if (id.startsWith("new-") || id.startsWith("local-")) continue;
        const { error: delError } = await supabase
          .from("company_banks")
          .delete()
          .eq("id", id);
        if (delError) throw new Error(delError.message);
      }
      const saved: BankRow[] = [];
      for (let index = 0; index < persisted.length; index += 1) {
        const row = persisted[index];
        const sortOrder = index + 1;
        if (row.id.startsWith("new-")) {
          const { data, error: insError } = await supabase
            .from("company_banks")
            .insert({
              organization_id: organizationId,
              company_id: companyId,
              name: row.name,
              sort_order: sortOrder,
            })
            .select("id, name")
            .single();
          if (insError) throw new Error(insError.message);
          saved.push({
            id: String(data.id),
            name: String(data.name),
            originalName: String(data.name),
          });
        } else {
          const { error: updError } = await supabase
            .from("company_banks")
            .update({
              name: row.name,
              sort_order: sortOrder,
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          if (updError) throw new Error(updError.message);
          saved.push({ ...row, originalName: row.name });
        }
      }
      const renamed = cleaned
        .filter((row) => row.originalName && row.originalName !== row.name)
        .map((row) => ({ from: row.originalName, to: row.name }));
      onSaved(saved.length ? saved : cleaned, renamed);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Arrange banks"
      description="Add a bank, rename one, or drag it to the top. This order is used on every bank payment."
      className="max-w-xl"
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New bank name"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addBank();
              }
            }}
          />
          <Button type="button" variant="secondary" onClick={addBank}>
            Add
          </Button>
        </div>
        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-[var(--border)]">
          <ul className="divide-y divide-[var(--border)]">
            {rows.map((row, index) => (
              <li
                key={row.id}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex === null) return;
                  setRows((prev) => moveItem(prev, dragIndex, index));
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
                className="flex items-center gap-2 bg-white px-3 py-2"
              >
                <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-[var(--muted)]" />
                <span className="w-6 shrink-0 text-xs text-[var(--muted)]">
                  {index + 1}
                </span>
                <Input
                  value={row.name}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((item) =>
                        item.id === row.id ? { ...item, name: e.target.value } : item,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={index === 0}
                  onClick={() => setRows((prev) => moveItem(prev, index, index - 1))}
                  aria-label="Move up"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={index === rows.length - 1}
                  onClick={() => setRows((prev) => moveItem(prev, index, index + 1))}
                  aria-label="Move down"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setRemoved((prev) =>
                      row.id.startsWith("new-") ? prev : [...prev, row.id],
                    );
                    setRows((prev) => prev.filter((item) => item.id !== row.id));
                  }}
                  aria-label="Remove bank"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" loading={saving} onClick={() => void save()}>
            Save arrangement
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
