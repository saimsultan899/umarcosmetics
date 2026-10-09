/**
 * Local (desktop SQLite + IndexedDB) mirror of the organization main-company hub.
 *
 * Cloud Postgres still applies hub rules when the spoke outbox syncs.
 * These helpers only update local main-company masters/stock for offline UI —
 * never enqueue outbox mutations (sync_status: hub_mirror).
 */

import {
  getCachedHubContext,
  isMainHubCacheReady,
  type HubContext,
} from "@/lib/offline/cache-manager";
import { putCachedRow, getCachedRows } from "@/lib/offline/local-db";
import {
  hasLocalSqlite,
  localListMaster,
  localUpsertMaster,
  localBulkUpsertStockBalances,
} from "@/lib/offline/sqlite-client";

export type OfflineHubResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  hubProductId?: string | null;
  hubPartyId?: string | null;
  hubWarehouseId?: string | null;
};

const HUB_MIRROR_STATUS = "hub_mirror";

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `hub-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function norm(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

async function loadMaster(
  table: "products" | "parties" | "warehouses" | "stock_balances",
  companyId: string,
): Promise<Record<string, unknown>[]> {
  if (hasLocalSqlite()) {
    const listed = await localListMaster(table, companyId, 20000);
    if (listed.ok && listed.rows?.length) return listed.rows;
  }
  return (await getCachedRows(table, companyId)) as Record<string, unknown>[];
}

async function upsertMasterLocal(
  table: "products" | "parties" | "warehouses" | "stock_balances",
  row: Record<string, unknown>,
  companyId: string,
) {
  const withStatus = {
    ...row,
    company_id: companyId,
    sync_status: row.sync_status || HUB_MIRROR_STATUS,
    updated_at: new Date().toISOString(),
  };
  if (hasLocalSqlite()) {
    await localUpsertMaster(table, withStatus);
  }
  await putCachedRow(table, companyId, withStatus, "pending");
}

export async function resolveOfflineHubContext(
  spokeCompanyId: string,
): Promise<HubContext | null> {
  const ctx = await getCachedHubContext();
  if (!ctx?.mainCompanyId) return null;
  if (ctx.mainCompanyId === spokeCompanyId) {
    return ctx;
  }
  return ctx;
}

async function requireHubReady(
  spokeCompanyId: string,
): Promise<
  | { ok: true; mainId: string; ctx: HubContext }
  | { ok: false; result: OfflineHubResult }
> {
  if (!hasLocalSqlite()) {
    return {
      ok: false,
      result: {
        ok: false,
        skipped: true,
        reason: "Hub mirror needs the desktop app.",
      },
    };
  }
  const ctx = await resolveOfflineHubContext(spokeCompanyId);
  const mainId = ctx?.mainCompanyId || null;
  if (!mainId) {
    return {
      ok: false,
      result: {
        ok: true,
        skipped: true,
        reason: "No main company configured for this organization.",
      },
    };
  }
  if (mainId === spokeCompanyId) {
    return {
      ok: false,
      result: { ok: true, skipped: true, reason: "Already on main company." },
    };
  }
  const ready = await isMainHubCacheReady(mainId);
  if (!ready) {
    return {
      ok: false,
      result: {
        ok: false,
        skipped: true,
        reason:
          "Main company catalog is not cached on this PC yet. Connect once while online so hub stock can update offline.",
      },
    };
  }
  return { ok: true, mainId, ctx: ctx! };
}

async function findSpokeWarehouse(
  spokeCompanyId: string,
  warehouseId: string,
): Promise<Record<string, unknown> | null> {
  const whs = await loadMaster("warehouses", spokeCompanyId);
  return whs.find((w) => String(w.id) === String(warehouseId)) || null;
}

export async function ensureHubWarehouseForSpoke(
  spokeCompanyId: string,
  spokeWarehouseId: string | null | undefined,
  mainCompanyId: string,
  organizationId?: string | null,
): Promise<string | null> {
  if (!spokeWarehouseId) return null;
  const mainWhs = await loadMaster("warehouses", mainCompanyId);
  if (mainWhs.some((w) => String(w.id) === String(spokeWarehouseId))) {
    return String(spokeWarehouseId);
  }
  const spoke = await findSpokeWarehouse(spokeCompanyId, spokeWarehouseId);
  if (!spoke) return null;

  const byName = mainWhs.find(
    (w) => norm(w.name) === norm(spoke.name) && norm(w.name) !== "",
  );
  if (byName?.id) return String(byName.id);

  const id = newId();
  await upsertMasterLocal(
    "warehouses",
    {
      id,
      organization_id: organizationId || spoke.organization_id || null,
      name: spoke.name,
      code: spoke.code ?? null,
      address: spoke.address ?? null,
      is_active: true,
      sync_status: HUB_MIRROR_STATUS,
    },
    mainCompanyId,
  );
  return id;
}

async function applyStockDeltaLocal(
  companyId: string,
  productId: string,
  warehouseId: string,
  delta: number,
) {
  if (!delta) return;
  const rows = await loadMaster("stock_balances", companyId);
  const existing = rows.find(
    (r) =>
      String(r.product_id) === String(productId) &&
      String(r.warehouse_id) === String(warehouseId),
  );
  const nextQty = Number(existing?.qty || 0) + delta;
  const id = (existing?.id as string) || newId();
  const row = {
    id,
    company_id: companyId,
    product_id: productId,
    warehouse_id: warehouseId,
    qty: nextQty,
    sync_status: HUB_MIRROR_STATUS,
    updated_at: new Date().toISOString(),
  };
  if (hasLocalSqlite()) {
    await localBulkUpsertStockBalances(companyId, [row]);
  }
  await putCachedRow("stock_balances", companyId, row, "pending");
}

function barcodeTaken(
  products: Record<string, unknown>[],
  barcode: string,
  exceptId?: string,
) {
  const b = norm(barcode);
  if (!b) return false;
  return products.some(
    (p) =>
      String(p.id) !== String(exceptId || "") &&
      norm(p.barcode) === b,
  );
}

export async function ensureHubProduct(
  spokeCompanyId: string,
  spokeProductId: string,
): Promise<OfflineHubResult> {
  const gate = await requireHubReady(spokeCompanyId);
  if (!gate.ok) return gate.result;
  const { mainId, ctx } = gate;

  const products = await loadMaster("products", spokeCompanyId);
  const src = products.find((p) => String(p.id) === String(spokeProductId));
  if (!src) {
    return { ok: false, skipped: true, reason: "Spoke product not in local cache." };
  }

  if (String(src.company_id) === mainId) {
    return { ok: true, hubProductId: String(src.id) };
  }
  if (src.hub_product_id) {
    return { ok: true, hubProductId: String(src.hub_product_id) };
  }

  const mainProducts = await loadMaster("products", mainId);
  const byCode = mainProducts.find(
    (p) => norm(p.code) && norm(p.code) === norm(src.code),
  );
  if (byCode?.id) {
    const hubId = String(byCode.id);
    await syncProductFields(src, byCode, mainId, spokeCompanyId);
    await linkSpokeProductHub(spokeCompanyId, src, hubId);
    return { ok: true, hubProductId: hubId };
  }

  const hubWh = await ensureHubWarehouseForSpoke(
    spokeCompanyId,
    src.default_warehouse_id as string | null,
    mainId,
    (src.organization_id as string) || ctx.organizationId,
  );

  const barcode =
    src.barcode && !barcodeTaken(mainProducts, String(src.barcode))
      ? src.barcode
      : null;

  const hubId = newId();
  const hubRow: Record<string, unknown> = {
    ...src,
    id: hubId,
    company_id: mainId,
    organization_id: src.organization_id || ctx.organizationId,
    barcode,
    extra_barcodes: src.extra_barcodes ?? [],
    default_warehouse_id: hubWh,
    opening_qty: 0,
    hub_product_id: null,
    sync_status: HUB_MIRROR_STATUS,
  };
  await upsertMasterLocal("products", hubRow, mainId);
  await linkSpokeProductHub(spokeCompanyId, src, hubId);
  return { ok: true, hubProductId: hubId };
}

async function linkSpokeProductHub(
  spokeCompanyId: string,
  src: Record<string, unknown>,
  hubId: string,
) {
  const next = { ...src, hub_product_id: hubId, company_id: spokeCompanyId };
  // Keep spoke sync_status as-is (pending/synced) — only link field changes.
  if (hasLocalSqlite()) {
    await localUpsertMaster("products", {
      ...next,
      sync_status: src.sync_status || "pending",
    });
  }
  await putCachedRow(
    "products",
    spokeCompanyId,
    next,
    (src.sync_status as "pending" | "synced") || "pending",
  );
}

async function syncProductFields(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
  mainCompanyId: string,
  spokeCompanyId: string,
) {
  const mainProducts = await loadMaster("products", mainCompanyId);
  const hubWh = await ensureHubWarehouseForSpoke(
    spokeCompanyId,
    from.default_warehouse_id as string | null,
    mainCompanyId,
    from.organization_id as string | null,
  );
  let barcode = to.barcode;
  if (from.barcode) {
    const taken = barcodeTaken(
      mainProducts,
      String(from.barcode),
      String(to.id),
    );
    if (!taken) barcode = from.barcode;
  }
  const next = {
    ...to,
    name_en: from.name_en,
    name_ur: from.name_ur,
    product_type: from.product_type,
    manufacturer: from.manufacturer,
    category_group: from.category_group,
    barcode,
    extra_barcodes: from.extra_barcodes ?? to.extra_barcodes ?? [],
    default_warehouse_id: hubWh || to.default_warehouse_id,
    retail_rate: from.retail_rate,
    purchase_rate: from.purchase_rate,
    wholesale_rate: from.wholesale_rate,
    sale_rate: from.sale_rate,
    print_rate: from.print_rate,
    opening_rate: from.opening_rate,
    reorder_level: from.reorder_level,
    packing: from.packing,
    unit_type: from.unit_type,
    base_unit: from.base_unit,
    scheme: from.scheme,
    is_active: from.is_active,
    company_id: mainCompanyId,
    sync_status: to.sync_status === "synced" ? "synced" : HUB_MIRROR_STATUS,
  };
  await upsertMasterLocal("products", next, mainCompanyId);
}

export async function mirrorProductToHub(
  spokeCompanyId: string,
  productId: string,
): Promise<OfflineHubResult> {
  const gate = await requireHubReady(spokeCompanyId);
  if (!gate.ok) {
    // Main→spoke push when editing on main
    const ctx = await getCachedHubContext();
    if (ctx?.mainCompanyId === spokeCompanyId) {
      return mirrorMainProductToSpokes(spokeCompanyId, productId);
    }
    return gate.result;
  }

  const ensured = await ensureHubProduct(spokeCompanyId, productId);
  if (!ensured.ok || !ensured.hubProductId) return ensured;

  const products = await loadMaster("products", spokeCompanyId);
  const src = products.find((p) => String(p.id) === String(productId));
  const mainProducts = await loadMaster("products", gate.mainId);
  const hub = mainProducts.find(
    (p) => String(p.id) === String(ensured.hubProductId),
  );
  if (src && hub) {
    await syncProductFields(src, hub, gate.mainId, spokeCompanyId);
  }
  return ensured;
}

async function mirrorMainProductToSpokes(
  mainCompanyId: string,
  mainProductId: string,
): Promise<OfflineHubResult> {
  // Find spoke products linked to this hub id across membership companies is hard
  // without listing all; scan products from session memberships isn't available.
  // Best-effort: scan Active hub context spoke company only + main list for links.
  const ctx = await getCachedHubContext();
  const spokeId = ctx?.spokeCompanyId;
  if (!spokeId || spokeId === mainCompanyId) {
    return { ok: true, skipped: true };
  }
  const spokeProducts = await loadMaster("products", spokeId);
  const linked = spokeProducts.filter(
    (p) => String(p.hub_product_id) === String(mainProductId),
  );
  const mainProducts = await loadMaster("products", mainCompanyId);
  const src = mainProducts.find((p) => String(p.id) === String(mainProductId));
  if (!src) return { ok: false, reason: "Main product missing locally." };
  for (const spoke of linked) {
    await syncProductFields(src, spoke, spokeId, mainCompanyId);
    // syncProductFields writes to "mainCompanyId" arg as company — fix: write to spoke
    await upsertMasterLocal(
      "products",
      {
        ...spoke,
        name_en: src.name_en,
        name_ur: src.name_ur,
        product_type: src.product_type,
        manufacturer: src.manufacturer,
        category_group: src.category_group,
        barcode: src.barcode,
        extra_barcodes: src.extra_barcodes ?? [],
        retail_rate: src.retail_rate,
        purchase_rate: src.purchase_rate,
        wholesale_rate: src.wholesale_rate,
        sale_rate: src.sale_rate,
        print_rate: src.print_rate,
        opening_rate: src.opening_rate,
        reorder_level: src.reorder_level,
        packing: src.packing,
        unit_type: src.unit_type,
        base_unit: src.base_unit,
        scheme: src.scheme,
        is_active: src.is_active,
        company_id: spokeId,
        hub_product_id: mainProductId,
        sync_status: HUB_MIRROR_STATUS,
      },
      spokeId,
    );
  }
  return { ok: true, hubProductId: mainProductId };
}

export async function ensureHubParty(
  spokeCompanyId: string,
  spokePartyId: string,
): Promise<OfflineHubResult> {
  const gate = await requireHubReady(spokeCompanyId);
  if (!gate.ok) return gate.result;
  const { mainId, ctx } = gate;

  const parties = await loadMaster("parties", spokeCompanyId);
  const src = parties.find((p) => String(p.id) === String(spokePartyId));
  if (!src) {
    return { ok: false, skipped: true, reason: "Spoke party not in local cache." };
  }
  if (String(src.party_type || "").toUpperCase() === "EXPENSES") {
    return { ok: true, skipped: true, reason: "Expense parties stay local." };
  }
  if (String(src.company_id) === mainId) {
    return { ok: true, hubPartyId: String(src.id) };
  }
  if (src.hub_party_id) {
    return { ok: true, hubPartyId: String(src.hub_party_id) };
  }

  const mainParties = await loadMaster("parties", mainId);
  const code = (src.party_code as string) || (src.code as string) || "";
  const byCode = mainParties.find(
    (p) => norm(p.party_code || p.code) && norm(p.party_code || p.code) === norm(code),
  );
  if (byCode?.id) {
    const hubId = String(byCode.id);
    await syncPartyFields(src, byCode, mainId);
    await linkSpokePartyHub(spokeCompanyId, src, hubId);
    return { ok: true, hubPartyId: hubId };
  }

  const hubId = newId();
  const hubRow: Record<string, unknown> = {
    ...src,
    id: hubId,
    company_id: mainId,
    organization_id: src.organization_id || ctx.organizationId,
    party_code: code || src.party_code,
    code: code || src.code,
    opening_balance: 0,
    hub_party_id: null,
    sync_status: HUB_MIRROR_STATUS,
  };
  await upsertMasterLocal("parties", hubRow, mainId);
  await linkSpokePartyHub(spokeCompanyId, src, hubId);
  return { ok: true, hubPartyId: hubId };
}

async function linkSpokePartyHub(
  spokeCompanyId: string,
  src: Record<string, unknown>,
  hubId: string,
) {
  const next = { ...src, hub_party_id: hubId, company_id: spokeCompanyId };
  if (hasLocalSqlite()) {
    await localUpsertMaster("parties", {
      ...next,
      sync_status: src.sync_status || "pending",
    });
  }
  await putCachedRow(
    "parties",
    spokeCompanyId,
    next,
    (src.sync_status as "pending" | "synced") || "pending",
  );
}

async function syncPartyFields(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
  companyId: string,
) {
  const next = {
    ...to,
    name_en: from.name_en,
    name_ur: from.name_ur,
    party_type: from.party_type,
    party_subtype: from.party_subtype,
    address: from.address,
    sub_head: from.sub_head,
    city: from.city,
    head: from.head,
    route: from.route,
    phone: from.phone,
    mobile: from.mobile,
    contact_person: from.contact_person,
    ntn: from.ntn,
    credit_limit: from.credit_limit,
    sale_channel: from.sale_channel,
    is_active: from.is_active,
    company_id: companyId,
    sync_status: to.sync_status === "synced" ? "synced" : HUB_MIRROR_STATUS,
  };
  await upsertMasterLocal("parties", next, companyId);
}

export async function mirrorPartyToHub(
  spokeCompanyId: string,
  partyId: string,
): Promise<OfflineHubResult> {
  const gate = await requireHubReady(spokeCompanyId);
  if (!gate.ok) {
    const ctx = await getCachedHubContext();
    if (ctx?.mainCompanyId === spokeCompanyId) {
      return mirrorMainPartyToSpokes(spokeCompanyId, partyId);
    }
    return gate.result;
  }
  const ensured = await ensureHubParty(spokeCompanyId, partyId);
  if (!ensured.ok || !ensured.hubPartyId) return ensured;
  const parties = await loadMaster("parties", spokeCompanyId);
  const src = parties.find((p) => String(p.id) === String(partyId));
  const mainParties = await loadMaster("parties", gate.mainId);
  const hub = mainParties.find(
    (p) => String(p.id) === String(ensured.hubPartyId),
  );
  if (src && hub) await syncPartyFields(src, hub, gate.mainId);
  return ensured;
}

async function mirrorMainPartyToSpokes(
  mainCompanyId: string,
  mainPartyId: string,
): Promise<OfflineHubResult> {
  const ctx = await getCachedHubContext();
  const spokeId = ctx?.spokeCompanyId;
  if (!spokeId || spokeId === mainCompanyId) {
    return { ok: true, skipped: true };
  }
  const spokeParties = await loadMaster("parties", spokeId);
  const linked = spokeParties.filter(
    (p) => String(p.hub_party_id) === String(mainPartyId),
  );
  const mainParties = await loadMaster("parties", mainCompanyId);
  const src = mainParties.find((p) => String(p.id) === String(mainPartyId));
  if (!src) return { ok: false, reason: "Main party missing locally." };
  for (const spoke of linked) {
    await upsertMasterLocal(
      "parties",
      {
        ...spoke,
        name_en: src.name_en,
        name_ur: src.name_ur,
        party_type: src.party_type,
        party_subtype: src.party_subtype,
        address: src.address,
        sub_head: src.sub_head,
        city: src.city,
        head: src.head,
        route: src.route,
        phone: src.phone,
        mobile: src.mobile,
        contact_person: src.contact_person,
        ntn: src.ntn,
        credit_limit: src.credit_limit,
        sale_channel: src.sale_channel,
        is_active: src.is_active,
        company_id: spokeId,
        hub_party_id: mainPartyId,
        sync_status: HUB_MIRROR_STATUS,
      },
      spokeId,
    );
  }
  return { ok: true, hubPartyId: mainPartyId };
}

export async function applyHubPurchaseStock(opts: {
  spokeCompanyId: string;
  warehouseId: string;
  productId: string;
  qty: number;
}): Promise<OfflineHubResult> {
  const qty = Number(opts.qty || 0);
  if (!qty) return { ok: true, skipped: true };

  const gate = await requireHubReady(opts.spokeCompanyId);
  if (!gate.ok) return gate.result;

  const ensured = await ensureHubProduct(opts.spokeCompanyId, opts.productId);
  if (!ensured.ok || !ensured.hubProductId) return ensured;

  const hubWh = await ensureHubWarehouseForSpoke(
    opts.spokeCompanyId,
    opts.warehouseId,
    gate.mainId,
    gate.ctx.organizationId,
  );
  if (!hubWh) {
    return {
      ok: false,
      skipped: true,
      reason: "Could not map warehouse to main company offline.",
    };
  }

  await applyStockDeltaLocal(
    gate.mainId,
    ensured.hubProductId,
    hubWh,
    Math.abs(qty),
  );
  return {
    ok: true,
    hubProductId: ensured.hubProductId,
    hubWarehouseId: hubWh,
  };
}

/**
 * Run after a spoke product/party/purchase is persisted locally.
 * Returns a user-facing note when hub work was skipped.
 */
export async function applyOfflineHubSideEffects(opts: {
  mutationType: string;
  companyId: string;
  documentId: string;
  payload: Record<string, unknown>;
  stockChanges?: Array<{
    productId: string;
    warehouseId: string;
    delta: number;
  }>;
}): Promise<{ note?: string }> {
  const type = opts.mutationType;
  try {
    if (type === "product_create" || type === "product_update") {
      const res = await mirrorProductToHub(opts.companyId, opts.documentId);
      if (res.skipped && res.reason && !res.ok) {
        return { note: res.reason };
      }
      if (!res.ok && res.reason) return { note: res.reason };
      return {};
    }
    if (type === "party_create" || type === "party_update") {
      const res = await mirrorPartyToHub(opts.companyId, opts.documentId);
      if (res.skipped && res.reason && !res.ok) {
        return { note: res.reason };
      }
      if (!res.ok && res.reason) return { note: res.reason };
      return {};
    }
    if (type === "purchase_invoice") {
      const changes =
        opts.stockChanges?.filter((c) => c.delta > 0) ||
        (Array.isArray(opts.payload.items)
          ? (opts.payload.items as Record<string, unknown>[]).map((item) => ({
              productId: String(item.product_id || ""),
              warehouseId: String(
                opts.payload.warehouse_id || item.warehouse_id || "",
              ),
              delta: Math.abs(Number(item.qty || 0) + Number(item.bonus_qty || 0)),
            }))
          : []);
      let lastSkip: string | undefined;
      for (const change of changes) {
        if (!change.productId || !change.warehouseId || !change.delta) continue;
        const res = await applyHubPurchaseStock({
          spokeCompanyId: opts.companyId,
          warehouseId: change.warehouseId,
          productId: change.productId,
          qty: change.delta,
        });
        if (res.skipped && res.reason) lastSkip = res.reason;
        if (!res.ok && res.reason) lastSkip = res.reason;
      }
      if (lastSkip) return { note: lastSkip };
      return {};
    }
  } catch (err) {
    console.warn("[offline-hub] side effects failed:", err);
    return {
      note:
        "Saved locally; main hub update will apply when you reconnect.",
    };
  }
  return {};
}
