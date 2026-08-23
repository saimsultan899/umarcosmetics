"use client";

import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import { createClient } from "@/lib/supabase/client";
import type { Warehouse } from "@/lib/types/database";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function WarehouseForm({
  companyId,
  organizationId,
  initial,
  onDone,
}: {
  companyId: string;
  organizationId: string;
  initial?: Warehouse | null;
  onDone?: () => void;
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(initial?.name || "");
  const [code, setCode] = useState(initial?.code || "");
  const [address, setAddress] = useState(initial?.address || "");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: saveError } = initial
      ? await supabase
          .from("warehouses")
          .update({
            name: name.trim(),
            code: code.trim() || null,
            address: address.trim() || null,
          })
          .eq("id", initial.id)
      : await supabase.from("warehouses").insert({
          organization_id: organizationId,
          company_id: companyId,
          name: name.trim(),
          code: code.trim() || null,
          address: address.trim() || null,
          is_active: true,
        });
    setLoading(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    if (!initial) {
      setName("");
      setCode("");
      setAddress("");
    }
    onDone?.();
    closeDialog?.();
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 sm:grid-cols-3"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >      <div>
        <Label>Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="KEUNE"
        />
      </div>
      <div>
        <Label>Code</Label>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="KEUNE"
        />
      </div>
      <div>
        <Label>Address</Label>
        <Input value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      {error ? (
        <p className="sm:col-span-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      <div className="sm:col-span-3">
        <Button type="submit" disabled={loading}>
          {loading
            ? "Saving..."
            : initial
              ? "Update warehouse"
              : "Add warehouse"}
        </Button>
      </div>
    </form>
  );
}
