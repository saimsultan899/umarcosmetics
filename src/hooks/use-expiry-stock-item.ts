"use client";

import { useSyncStatus } from "@/components/offline/sync-provider";
import { getCachedRows } from "@/lib/offline/local-db";
import type { ExpiryStockRow } from "@/lib/queries/expiry";
import { createClient } from "@/lib/supabase/client";
import type { Product } from "@/lib/types/database";
import { useEffect, useState } from "react";

export type ExpiryStockItemState = {
  row: ExpiryStockRow | null;
  loading: boolean;
  notFound: boolean;
};

export function useExpiryStockItem({
  companyId,
  productId,
  initialRow,
  initialOffline = false,
}: {
  companyId: string;
  productId: string;
  initialRow?: ExpiryStockRow | null;
  initialOffline?: boolean;
}): ExpiryStockItemState {
  const sync = useSyncStatus();
  const isOnline = sync ? sync.online : !initialOffline;

  const [row, setRow] = useState<ExpiryStockRow | null>(initialRow || null);
  const [loading, setLoading] = useState<boolean>(!initialRow);
  const [notFound, setNotFound] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isOnline) {
        // Offline: read from local SQLite / IndexedDB
        try {
          const { hasLocalSqlite, localListMaster, localListByEntity } = await import(
            "@/lib/offline/sqlite-client"
          );

          let products: Record<string, unknown>[] = [];
          let receipts: Record<string, unknown>[] = [];
          let claims: Record<string, unknown>[] = [];

          if (hasLocalSqlite()) {
            const [prodRes, recRes, clmRes] = await Promise.all([
              localListMaster("products", companyId),
              localListByEntity(companyId, "expiry_receipt"),
              localListByEntity(companyId, "expiry_claim"),
            ]);
            products = prodRes.rows || [];
            receipts = recRes.rows || [];
            claims = clmRes.rows || [];
          }

          if (!products.length) products = await getCachedRows("products", companyId);
          if (!receipts.length) receipts = await getCachedRows("expiry_receipts", companyId);
          if (!claims.length) claims = await getCachedRows("expiry_claims", companyId);

          if (cancelled) return;

          const product = products.find(
            (p) => String(p.id) === productId || String(p.code) === productId,
          ) as unknown as Product | undefined;

          if (!product) {
            setNotFound(true);
            setLoading(false);
            return;
          }

          let qty = 0;

          // Sum receipts
          for (const r of receipts) {
            const payload = (r.payload as Record<string, unknown> | undefined) || r;
            const rawLines =
              (Array.isArray(payload.items) && payload.items) ||
              (Array.isArray(payload.lines) && payload.lines) ||
              (Array.isArray(r.lines) && r.lines) ||
              [];
            for (const line of rawLines as Record<string, unknown>[]) {
              if (
                String(line.product_id) === productId ||
                String(line.product_id) === product.id ||
                String(line.product_code) === product.code
              ) {
                qty += Number(line.qty || 0);
              }
            }
          }

          // Deduct claims
          for (const c of claims) {
            const payload = (c.payload as Record<string, unknown> | undefined) || c;
            const rawLines =
              (Array.isArray(payload.items) && payload.items) ||
              (Array.isArray(payload.lines) && payload.lines) ||
              (Array.isArray(c.lines) && c.lines) ||
              [];
            for (const line of rawLines as Record<string, unknown>[]) {
              if (
                String(line.product_id) === productId ||
                String(line.product_id) === product.id ||
                String(line.product_code) === product.code
              ) {
                qty -= Number(line.qty || 0);
              }
            }
          }

          const onHand = Math.max(0, qty);
          const rate = Number(product.purchase_rate || product.retail_rate || 0);
          const amount = onHand * rate;

          setRow({
            product_id: product.id,
            product_code: product.code,
            product_name: product.name_en || (product as Record<string, unknown>).name as string || "",
            qty: onHand,
            rate,
            amount,
          });
          setNotFound(false);
          setLoading(false);
        } catch (err) {
          console.error("Failed to load offline expiry stock item:", err);
          if (!cancelled) {
            setNotFound(true);
            setLoading(false);
          }
        }
        return;
      }

      // Online: if initialRow is provided on mount, we're good
      if (initialRow) {
        setRow(initialRow);
        setNotFound(false);
        setLoading(false);
        return;
      }

      // Online fetch fallback
      try {
        setLoading(true);
        const supabase = createClient();
        const { data, error } = await supabase
          .from("expiry_stock_balances")
          .select("product_id, qty, products(code, name_en, purchase_rate)")
          .eq("company_id", companyId)
          .eq("product_id", productId)
          .maybeSingle();

        if (cancelled) return;

        if (error || !data) {
          setNotFound(true);
          setLoading(false);
          return;
        }

        const product = Array.isArray(data.products) ? data.products[0] : data.products;
        const qty = Number(data.qty || 0);
        const rate = Number(product?.purchase_rate || 0);

        setRow({
          product_id: data.product_id,
          product_code: product?.code || "",
          product_name: product?.name_en || "",
          qty,
          rate,
          amount: qty * rate,
        });
        setNotFound(false);
        setLoading(false);
      } catch (err) {
        console.error("Failed to fetch expiry stock item:", err);
        if (!cancelled) {
          setNotFound(true);
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [companyId, productId, isOnline, initialRow]);

  return { row, loading, notFound };
}
