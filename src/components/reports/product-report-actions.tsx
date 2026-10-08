"use client";

import { ProductForm } from "@/components/forms/product-form";
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { deleteCachedRow } from "@/lib/offline/local-db";
import { offlineAwareSubmit } from "@/lib/offline/offline-submit";
import { createClient } from "@/lib/supabase/client";
import type { Product, Warehouse } from "@/lib/types/database";
import { useEffect, useState } from "react";

function ProductEditForm({
  productId,
  companyId,
  organizationId,
  onDone,
}: {
  productId: string;
  companyId: string;
  organizationId: string;
  onDone: () => void;
}) {
  const [product, setProduct] = useState<Product | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void Promise.all([
      supabase.from("products").select("*").eq("id", productId).single(),
      supabase
        .from("warehouses")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name"),
    ]).then(([productRes, warehouseRes]) => {
      if (productRes.error || !productRes.data) {
        setError(productRes.error?.message || "Product not found");
        return;
      }
      setProduct(productRes.data as Product);
      setWarehouses((warehouseRes.data as Warehouse[]) || []);
    });
  }, [productId, companyId]);

  if (error) return <p className="text-sm text-rose-700">{error}</p>;
  if (!product) {
    return <p className="text-sm text-[var(--muted)]">Loading product…</p>;
  }
  return (
    <ProductForm
      companyId={companyId}
      organizationId={organizationId}
      warehouses={warehouses}
      initial={product}
      onDone={onDone}
    />
  );
}

export function ProductReportActions({
  productId,
  companyId,
  organizationId,
  productLabel,
  fields,
  canEdit,
  canInactivate,
  canDelete,
}: {
  productId: string;
  companyId: string;
  organizationId: string;
  productLabel: string;
  fields: DetailField[];
  canEdit: boolean;
  canInactivate: boolean;
  canDelete: boolean;
}) {
  async function inactivate() {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .single();
    if (error || !data) throw new Error(error?.message || "Product not found");
    const payload = { ...(data as Product), is_active: false };
    await offlineAwareSubmit({
      mutationType: "product_update",
      companyId,
      organizationId,
      cacheStore: "products",
      cacheRecord: payload,
      payload,
    });
  }

  async function remove() {
    const supabase = createClient();
    const { error } = await supabase.rpc("delete_product", {
      p_product_id: productId,
    });
    if (error) {
      const msg = error.message || "";
      if (/organization admin/i.test(msg)) {
        throw new Error("Only the organization admin can delete products.");
      }
      if (/posted documents/i.test(msg) || error.code === "23503") {
        throw new Error(
          msg.includes("posted documents")
            ? msg
            : "This product is still on a posted bill. Mark it inactive instead.",
        );
      }
      throw new Error(msg);
    }
    await deleteCachedRow("products", productId).catch(() => {});
  }

  return (
    <RowActions
      viewTitle={productLabel}
      viewFields={fields}
      editTitle={`Update ${productLabel}`}
      allowEdit={canEdit}
      editContent={
        canEdit
          ? (close) => (
              <ProductEditForm
                productId={productId}
                companyId={companyId}
                organizationId={organizationId}
                onDone={close}
              />
            )
          : undefined
      }
      allowDelete={canDelete || canInactivate}
      deleteTitle={canDelete ? `Delete ${productLabel}?` : `Hide ${productLabel}?`}
      deleteDescription={
        canDelete
          ? "Removes the product if it is not on any posted bill. If it is still on a posted bill, mark it inactive instead."
          : "The product stays on old invoices and is hidden from new ones. Stock history is kept."
      }
      deleteConfirmLabel={canDelete ? "Delete product" : "Hide product"}
      onDelete={canDelete ? remove : canInactivate ? inactivate : undefined}
    />
  );
}
