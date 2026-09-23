"use client";

import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { Company, Organization } from "@/lib/types/database";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function CompanyAdminForm({
  organizations,
  initial,
  defaultOrgId,
  onDone,
}: {
  organizations: Organization[];
  initial?: Company | null;
  defaultOrgId?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  const [organizationId, setOrganizationId] = useState(
    initial?.organization_id || defaultOrgId || organizations[0]?.id || "",
  );
  const [name, setName] = useState(initial?.name || "");
  const [code, setCode] = useState(initial?.code || "");
  const [city, setCity] = useState(initial?.city || "");
  const [address, setAddress] = useState(initial?.address || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [ntn, setNtn] = useState(initial?.ntn || "");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [warehouse, setWarehouse] = useState("MAIN");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();

    if (initial) {
      const { error: saveError } = await supabase
        .from("companies")
        .update({
          organization_id: organizationId,
          name: name.trim(),
          code: code.trim() || null,
          city: city.trim() || null,
          address: address.trim() || null,
          phone: phone.trim() || null,
          ntn: ntn.trim() || null,
        })
        .eq("id", initial.id);
      if (saveError) {
        setLoading(false);
        setError(saveError.message);
        return;
      }
      if (isActive !== initial.is_active) {
        const { error: statusError } = await supabase.rpc(
          "admin_set_company_active",
          {
            p_company_id: initial.id,
            p_is_active: isActive,
          },
        );
        if (statusError) {
          setLoading(false);
          setError(statusError.message);
          return;
        }
      }
      setLoading(false);
    } else {
      if (!organizationId) {
        setLoading(false);
        setError("Select an organization first.");
        return;
      }
      const { error: rpcError } = await supabase.rpc("admin_create_company", {
        p_organization_id: organizationId,
        p_name: name.trim(),
        p_code: code.trim() || null,
        p_address: address.trim() || null,
        p_city: city.trim() || null,
        p_phone: phone.trim() || null,
        p_ntn: ntn.trim() || null,
        p_default_warehouse: warehouse.trim() || "MAIN",
        p_attach_caller: false,
      });
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
        <Label>Organization</Label>
        <Select
          value={organizationId}
          onChange={(e) => setOrganizationId(e.target.value)}
          required
          disabled={Boolean(initial)}
        >
          <option value="">Select organization</option>
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Company name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Umar Cosmetic"
            required
          />
        </div>
        <div>
          <Label>Code</Label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="UMAR"
          />
        </div>
        <div>
          <Label>City</Label>
          <Input value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div>
          <Label>Phone</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label>Address</Label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div>
          <Label>NTN</Label>
          <Input value={ntn} onChange={(e) => setNtn(e.target.value)} />
        </div>
        {initial ? (
          <div>
            <Label>Status (Active / Inactive)</Label>
            <Select
              value={isActive ? "active" : "inactive"}
              onChange={(e) => setIsActive(e.target.value === "active")}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Inactive locks the workspace without deleting data.
            </p>
          </div>
        ) : (
          <div>
            <Label>Default stock company</Label>
            <Input
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value)}
              placeholder="MAIN"
            />
          </div>
        )}
      </div>
      {!initial ? (
        <p className="text-xs text-[var(--muted)]">
          Creates the company and default warehouse. Attach a client login from
          Clients or the New client wizard — you keep platform access via Super
          Admin.
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={loading || !organizations.length}>
        {loading
          ? "Saving..."
          : initial
            ? "Save company"
            : "Create company"}
      </Button>
    </form>
  );
}
