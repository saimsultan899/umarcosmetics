"use client";

import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { Organization } from "@/lib/types/database";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function OrganizationForm({
  initial,
  onDone,
}: {
  initial?: Organization | null;
  onDone?: () => void;
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  const [name, setName] = useState(initial?.name || "");
  const [status, setStatus] = useState<"active" | "suspended">(
    initial?.status || "active",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();

    if (initial) {
      const { error: saveError } = await supabase
        .from("organizations")
        .update({ name: name.trim(), status })
        .eq("id", initial.id);
      setLoading(false);
      if (saveError) {
        setError(saveError.message);
        return;
      }
    } else {
      const { error: rpcError } = await supabase.rpc(
        "admin_create_organization",
        {
          p_name: name.trim(),
          p_status: status,
        },
      );
      setLoading(false);
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
    }

    onDone?.();
    closeDialog?.();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label>Organization name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Umar Group"
          required
        />
      </div>
      <div>
        <Label>Status</Label>
        <Select
          value={status}
          onChange={(e) =>
            setStatus(e.target.value === "suspended" ? "suspended" : "active")
          }
        >
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </Select>
      </div>
      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={loading}>
        {loading
          ? "Saving..."
          : initial
            ? "Save organization"
            : "Create organization"}
      </Button>
    </form>
  );
}
