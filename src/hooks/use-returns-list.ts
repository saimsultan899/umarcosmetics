"use client";

import { useSyncStatus } from "@/components/offline/sync-provider";
import { getCachedRows } from "@/lib/offline/local-db";
import {
  buildPaginationMeta,
  parsePaginationParams,
} from "@/lib/pagination";
import {
  fetchDocumentList,
  documentListConfigs,
  type DocumentListRow,
  type DocumentListSummary,
} from "@/lib/queries/documents";
import { createClient } from "@/lib/supabase/client";
import type { Party, Product, Warehouse } from "@/lib/types/database";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ReturnKind = "sale" | "purchase";

type ReturnListResult = {
  rows: DocumentListRow[];
  pagination: ReturnType<typeof buildPaginationMeta>;
  summary: DocumentListSummary;
};

const EMPTY_SUMMARY: DocumentListSummary = {
  totalAmount: 0,
  cashTotal: 0,
  creditTotal: 0,
  trend: [],
  mix: [],
};

const ENTITY_TYPE: Record<ReturnKind, string> = {
  sale: "sale_return",
  purchase: "purchase_return",
};

const HREF_PREFIX: Record<ReturnKind, string> = {
  sale: "/sales/returns",
  purchase: "/purchases/returns",
};

const CACHE_STORE: Record<ReturnKind, "sale_returns" | "purchase_returns"> = {
  sale: "sale_returns",
  purchase: "purchase_returns",
};

export type ReturnsListState = ReturnListResult & {
  parties: Party[];
  products: Product[];
  warehouses: Warehouse[];
  loading: boolean;
};

export function useReturnsList({
  companyId,
  kind,
  initialData,
  initialParties = [],
  initialProducts = [],
  initialWarehouses = [],
  initialOffline = false,
}: {
  companyId: string;
  kind: ReturnKind;
  initialData?: ReturnListResult | null;
  initialParties?: Party[];
  initialProducts?: Product[];
  initialWarehouses?: Warehouse[];
  initialOffline?: boolean;
}): ReturnsListState & { refetch: () => Promise<void> } {
  const sync = useSyncStatus();
  const isOnline = sync ? sync.online : !initialOffline;
  const searchParams = useSearchParams();

  const [data, setData] = useState<ReturnListResult>(
    initialData || {
      rows: [],
      pagination: { page: 1, pageSize: 24, total: 0, totalPages: 1, from: 0, to: 0 },
      summary: EMPTY_SUMMARY,
    },
  );
  const [parties, setParties] = useState<Party[]>(initialParties);
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [warehouses, setWarehouses] = useState<Warehouse[]>(initialWarehouses);
  const [loading, setLoading] = useState(!initialData);
  const isFirstMount = useRef(true);

  const spRecord = useMemo(() => {
    const rec: Record<string, string | string[] | undefined> = {};
    searchParams.forEach((v, k) => { rec[k] = v; });
    return rec;
  }, [searchParams]);

  const load = useCallback(async () => {
    if (!companyId) return;

    if (!isOnline) {
      setLoading(true);
      try {
        const { hasLocalSqlite, localListMaster, localListByEntity } = await import(
          "@/lib/offline/sqlite-client"
        );

        let docRows: Record<string, unknown>[] = [];
        let partyRows: Record<string, unknown>[] = [];
        let productRows: Record<string, unknown>[] = [];
        let warehouseRows: Record<string, unknown>[] = [];

        if (hasLocalSqlite()) {
          const [docRes, partyRes, prodRes, whRes] = await Promise.all([
            localListByEntity(companyId, ENTITY_TYPE[kind]),
            localListMaster("parties", companyId),
            localListMaster("products", companyId),
            localListMaster("warehouses", companyId),
          ]);
          docRows = docRes.rows || [];
          partyRows = partyRes.rows || [];
          productRows = prodRes.rows || [];
          warehouseRows = whRes.rows || [];
        }

        if (!docRows.length) docRows = await getCachedRows(CACHE_STORE[kind], companyId);
        if (!partyRows.length) partyRows = await getCachedRows("parties", companyId);
        if (!productRows.length) productRows = await getCachedRows("products", companyId);
        if (!warehouseRows.length) warehouseRows = await getCachedRows("warehouses", companyId);

        const pts = partyRows as unknown as Party[];
        const prods = productRows as unknown as Product[];
        const whs = warehouseRows as unknown as Warehouse[];
        setParties(pts);
        setProducts(prods);
        setWarehouses(whs);

        const q = (searchParams.get("q") || "").toLowerCase().trim();
        const warehouseId = searchParams.get("warehouse") || "";
        const hrefPrefix = HREF_PREFIX[kind];

        const allRows: DocumentListRow[] = docRows.map((r) => {
          const party = pts.find((p) => p.id === String(r.party_id));
          const wh = whs.find((w) => w.id === String(r.warehouse_id));
          return {
            id: String(r.id),
            docNo: String(r.return_no || r.doc_no || r.id),
            date: String(r.return_date || r.doc_date || ""),
            partyLabel: party
              ? `${party.party_code} — ${party.name_en}`
              : String(r.party_name || "—"),
            warehouseLabel: wh?.name || String(r.warehouse_name || "—"),
            paymentType: undefined,
            total: Number(r.grand_total ?? r.amount ?? 0),
            href: `${hrefPrefix}/${r.id}`,
            table: CACHE_STORE[kind],
            linesTable: "",
            linesFk: "",
          };
        });

        const filtered = allRows.filter((row) => {
          if (warehouseId) {
            const wh = whs.find((w) => w.name === row.warehouseLabel);
            if (!wh || wh.id !== warehouseId) return false;
          }
          if (q) {
            const text = `${row.docNo} ${row.partyLabel} ${row.warehouseLabel}`.toLowerCase();
            if (!text.includes(q)) return false;
          }
          return true;
        });

        const paginationParams = parsePaginationParams(spRecord);
        const pagination = buildPaginationMeta(filtered.length, paginationParams);
        const from = pagination.from ? pagination.from - 1 : 0;
        const paged = filtered.slice(from, pagination.to);

        const totalAmount = filtered.reduce((s, r) => s + r.total, 0);

        setData({
          rows: paged,
          pagination,
          summary: {
            totalAmount,
            cashTotal: 0,
            creditTotal: 0,
            trend: [],
            mix: [],
          },
        });
      } catch (err) {
        console.error(`Failed to load offline ${kind} returns:`, err);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Online
    setLoading(true);
    try {
      const supabase = createClient();
      const config =
        kind === "sale"
          ? documentListConfigs.saleReturn
          : documentListConfigs.purchaseReturn;

      const [{ data: partyData }, { data: prodData }, { data: whData }, list] =
        await Promise.all([
          supabase.from("parties").select("*").eq("company_id", companyId).eq("is_active", true).order("name_en"),
          supabase.from("products").select("*").eq("company_id", companyId).eq("is_active", true).order("code"),
          supabase.from("warehouses").select("*").eq("company_id", companyId).eq("is_active", true).order("name"),
          fetchDocumentList(supabase, companyId, spRecord, config),
        ]);

      setParties((partyData as Party[]) || []);
      setProducts((prodData as Product[]) || []);
      setWarehouses((whData as Warehouse[]) || []);
      setData(list);
    } catch (err) {
      console.error(`Failed to fetch online ${kind} returns:`, err);
    } finally {
      setLoading(false);
    }
  }, [companyId, kind, isOnline, searchParams, spRecord]);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      if (initialData && isOnline) return;
    }
    void load();
  }, [load, initialData, isOnline]);

  return { ...data, parties, products, warehouses, loading, refetch: load };
}
