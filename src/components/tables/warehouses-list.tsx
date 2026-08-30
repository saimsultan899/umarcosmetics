"use client";

import { WarehouseForm } from "@/components/forms/warehouse-form";
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { createClient } from "@/lib/supabase/client";
import type { Warehouse } from "@/lib/types/database";

function warehouseFields(w: Warehouse): DetailField[] {
  return [
    { label: "Name", value: w.name },
    { label: "Code", value: w.code || "—" },
    { label: "Address", value: w.address || "—" },
  ];
}

export function WarehousesList({
  warehouses,
  companyId,
  organizationId,
}: {
  warehouses: Warehouse[];
  companyId: string;
  organizationId: string;
}) {
  async function deactivate(id: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("warehouses")
      .update({ is_active: false })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }

  if (!warehouses.length) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]">
        No companies yet.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {warehouses.map((w) => (
        <div key={w.id} className="panel p-4">
          <p className="font-[family-name:var(--font-display)] text-lg font-semibold">
            {w.name}
          </p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            {w.code || "No code"}
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {w.address || "No address"}
          </p>
          <div className="mt-3 flex items-center justify-end gap-2">
            <RowActions
              viewTitle={w.name}
              editTitle={`Edit ${w.name}`}
              deleteTitle={`Remove ${w.name}?`}
              deleteDescription="This company will be removed from this list. It can be restored later if needed."
              viewFields={warehouseFields(w)}
              onDelete={() => deactivate(w.id)}
              editContent={(close) => (
                <WarehouseForm
                  companyId={companyId}
                  organizationId={organizationId}
                  initial={w}
                  onDone={close}
                />
              )}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
