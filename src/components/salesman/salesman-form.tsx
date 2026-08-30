"use client";

import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function SalesmanForm({
  companyId,
  organizationId,
  initial,
  onDone,
}: {
  companyId: string;
  organizationId: string;
  initial?: {
    id: string;
    full_name: string;
    phone?: string | null;
    code?: string | null;
  } | null;
  onDone?: () => void;
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState(initial?.full_name || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [code, setCode] = useState(initial?.code || "");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const name = fullName.trim();
    if (!name) {
      setError("Enter the salesman name.");
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const payload = {
      organization_id: organizationId,
      company_id: companyId,
      full_name: name,
      phone: phone.trim() || null,
      code: code.trim() || null,
      is_active: true,
      updated_at: new Date().toISOString(),
    };
    const { error: saveError } = initial
      ? await supabase.from("salesmen").update(payload).eq("id", initial.id)
      : await supabase.from("salesmen").insert(payload);
    setLoading(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    closeDialog?.();
    onDone?.();
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >
      <div>
        <Label>Name</Label>
        <Input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="e.g. Umar Irfan"
          required
          autoFocus
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Phone</Label>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div>
          <Label>Code</Label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Optional short code"
          />
        </div>
      </div>
      <p className="text-xs text-[var(--muted)]">
        No login is created. Pick this name on sale invoices and recoveries —
        their performance appears in Salesman Report.
      </p>
      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={loading}>
        {loading
          ? "Saving..."
          : initial
            ? "Save salesman"
            : "Add salesman"}
      </Button>
    </form>
  );
}
