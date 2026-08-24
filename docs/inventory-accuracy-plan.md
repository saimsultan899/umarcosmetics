# Inventory Accuracy — Implementation Plan

> **Scope:** Three related features that make book-stock trustworthy and recover money owed by principals.
> **Features:** (1) Physical Stock Count & Adjustment, (2) Principal Claims, (3) Batch & Expiry tracking.
> **Status:** Plan for review — no code written yet.
> **Grounding:** Signatures and conventions below were read from the actual repo (`supabase/migrations/*`, `src/lib/types/*`, `src/components/trading/*`).

---

## Step 0 — Prerequisite (MUST do before any code)

The real database schema and RLS policies live **only in the remote Supabase project** — the repo's `20260806213955_phase1_foundation_schema.sql` is a stub, and the live `create_sale_invoice` / `create_purchase_invoice` / `post_ledger` / `next_document_no` / stock-move-type enum are not fully in the repo. All three features alter `stock_balances` / `stock_movements` and the posting RPCs, so we must materialize the truth first.

```bash
npx supabase db pull --linked
```

Then commit the pulled migration. **Confirm these before building:**

- Exact members of the `stock_move_type` enum (we know `'sale'` and `'adjustment'` exist; need the full list).
- Full signature of `private.post_ledger(...)` and `public.next_document_no(...)`.
- Columns on `stock_movements` (we know: `company_id, warehouse_id, product_id, move_type, qty, ref_table, ref_id, created_by`).
- The exact unique key on `stock_balances` (we know: `(company_id, warehouse_id, product_id)`).
- Existing SELECT/write RLS policies on the trading doc tables.

Without this, we'd be editing the stock engine blind.

---

## Conventions this plan follows (observed in your code)

Every new posting RPC mirrors the existing `create_sale_invoice` pattern:

- `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`
- First line: `if not private.can_write_company(v_company_id) then raise exception 'No write access'; end if;`
- Single **JSONB payload** arg; header insert, then `for v_item in select * from jsonb_array_elements(p_payload->'items')`.
- Document number: `v_no := public.next_document_no(v_company_id, '<doc_type>', null);`
- Stock side: `private.apply_stock_delta(company_id, warehouse_id, product_id, qty_delta, '<move_type>', '<ref_table>', ref_id, allow_negative)`.
- Accounting side: `private.post_ledger(org_id, company_id, party_id, date, debit, credit, narration, ref_table, ref_id, '<code>')` — **debit raises the party's receivable** (as sales do).
- `status = 'posted'`, `created_by = auth.uid()`.
- Footer: `REVOKE ALL ... FROM PUBLIC;` then `GRANT EXECUTE ... TO authenticated;`
- **RLS:** add a `SELECT` policy `USING (private.has_company_access(company_id))` on each new table; **no** direct insert/update/delete policies — all writes go through the SECURITY-DEFINER RPC.
- **UI:** new pages mirror `src/app/(app)/inventory/load-sheets/` (list `page.tsx` + `[id]/page.tsx`) and forms mirror `src/components/trading/load-sheet-form.tsx` / `line-items-editor.tsx`.
- Doc lifecycle: `status` ∈ `draft | posted | cancelled` (from `DocStatus`).
- These are **office/godown features** → they use normal online Supabase calls, **not** the offline IndexedDB queue (that queue is field-sale + recovery only). Exception: batch selection touches field sales — see Feature 3 caveat.

---

## Feature 2 — Physical Stock Count & Adjustment  *(Phase A — build first)*

Smallest change, highest data-integrity payoff, standalone. Reuses the existing `'adjustment'` move type (already used for opening stock), so no enum change.

### Data model (new tables)
```
stock_counts
  id, organization_id, company_id,
  count_no text,            -- next_document_no(company,'stock_count',null)
  count_date date,
  warehouse_id uuid,
  status doc_status,        -- draft | posted | cancelled
  narration text,
  created_by, updated_by, created_at, updated_at

stock_count_items
  id, stock_count_id, company_id,
  product_id, product_code, product_name,
  book_qty numeric(14,3),      -- snapshot shown to counter
  counted_qty numeric(14,3),
  variance_qty numeric(14,3),  -- computed at post time
  rate numeric(14,2),          -- optional, for valuation
  sort_order int
```

### RPCs
- `public.start_stock_count(p_payload)` → creates a `draft` for a warehouse and (optionally) snapshots current `stock_balances.qty` into `book_qty` for the chosen products, so the operator has a sheet to reconcile against.
- `public.post_stock_count(p_payload)`:
  1. `can_write_company` gate.
  2. For each item: read **current** `stock_balances.qty` as `book_qty` (recompute at post time to avoid drift), `variance = counted_qty − book_qty`.
  3. If `variance <> 0`: `apply_stock_delta(company, warehouse, product, variance, 'adjustment', 'stock_counts', id, allow_negative := true)`.
  4. Set `status = 'posted'`.
  5. **(Optional, decision below)** valuation JV.

### Optional valuation posting
A stock gain/loss is a non-party GL entry. Your chart of accounts models GL heads as `parties` (types `ASSETS/EXPENSES/INCOME`). To value the variance, post two ledger lines (like a JV): Dr **Stock Adjustment (Loss)** / Cr **Inventory**, using `post_ledger` twice or the existing `create_journal_voucher`. **Recommend: ship without valuation first**, add it once the accountant confirms the two head IDs.

### RLS
`SELECT` policies on both tables via `has_company_access(company_id)`; writes RPC-only.

### UI
- `src/app/(app)/inventory/stock-counts/page.tsx` — list (mirror load-sheets list).
- `src/app/(app)/inventory/stock-counts/[id]/page.tsx` — count sheet: pick warehouse, add products (or "load all in warehouse"), enter counted qty, live variance column, **Post**.
- Print: blank count sheet (for the physical count) + posted variance report. Reuse `print-document.tsx`.
- Sidebar entry under **Products & Inventory**.

### Effort
**Small–Medium.** ~2 tables, 2 RPCs, 2 pages, 1 print view.

---

## Feature 1 — Principal Claims  *(Phase B)*

Track value recoverable from a principal/manufacturer for damaged / expired / scheme stock. The principal is an existing `parties` row (a supplier).

### Data model (new tables + enum)
```
enum claim_reason: damage | expiry | scheme | shortage | other

claims
  id, organization_id, company_id,
  claim_no text,               -- next_document_no(company,'principal_claim',null)
  claim_date date,
  supplier_party_id uuid,      -- the principal
  warehouse_id uuid null,      -- if goods are written off from a godown
  status doc_status,
  total_amount numeric(14,2),
  narration text,
  created_by, updated_by, timestamps

claim_items
  id, claim_id, company_id,
  product_id, product_code, product_name,
  reason claim_reason,
  qty numeric(14,3),
  rate numeric(14,2),
  amount numeric(14,2),
  batch_id uuid null,          -- wired in Feature 3 for expiry claims
  remove_stock boolean default true,
  sort_order int
```

### RPC — `public.post_principal_claim(p_payload)`
1. `can_write_company` gate; `claim_no` via `next_document_no`.
2. Insert header + items.
3. For each line with `remove_stock = true` (physically writing off damaged/expired goods):
   `apply_stock_delta(company, warehouse, product, -qty, 'adjustment', 'claims', id, allow_negative := false)`.
   *(Optionally add a dedicated `'claim'` value to `stock_move_type` for cleaner movement reports — decision below.)*
4. Book the recoverable against the principal:
   `post_ledger(org, company, supplier_party_id, date, total, 0, 'Claim '||claim_no, 'claims', id, 'CLM')`
   → **debits the supplier**, reducing what you owe them (or creating a receivable). The contra head mapping should be confirmed with your accountant.
5. `status = 'posted'`.

### Settlement
No new settlement doc needed initially — when the principal issues credit/goods, square it with the existing **Cash Receipt / Journal Voucher** against the supplier party. (A dedicated "claim settlement" doc can come later.)

### Reports
- **Claims register** (filter by principal, reason, date).
- **Outstanding claims by principal** (raised − settled) — can reuse the receivable/aging RPC pattern (`get_receivable_aging`) scoped to claim refs.

### UI
- `src/app/(app)/purchases/claims/page.tsx` + `[id]/page.tsx` (grouped with Purchases, since it faces suppliers).
- Form mirrors purchase-invoice-form: pick supplier, add lines with reason + qty + rate, **Post**, print.

### Effort
**Medium.** 2 tables + 1 enum, 1 RPC, 2 pages, 1–2 reports.

---

## Feature 3 — Batch & Expiry tracking  *(Phase C — largest, phased)*

The deep, cross-cutting change. Make it **opt-in per product** so simple items are unaffected.

### Data model
```
products.track_batches boolean not null default false   -- opt-in flag

batches
  id, organization_id, company_id, product_id,
  batch_no text,
  mfg_date date null,
  expiry_date date null,
  created_at
  UNIQUE (company_id, product_id, batch_no)

-- stock now keyed by batch:
stock_balances       + batch_id uuid null
stock_movements      + batch_id uuid null
```
Replace the `stock_balances` unique key with
`UNIQUE NULLS NOT DISTINCT (company_id, warehouse_id, product_id, batch_id)`
(Postgres 15+, which Supabase runs — treats the NULL batch of non-tracked products as a single row).

### Engine change
Add a trailing, defaulted arg so all existing callers keep working:
```
private.apply_stock_delta(..., p_ref_id uuid, p_allow_negative boolean default false,
                          p_batch_id uuid default null)
```
It upserts `stock_balances` including `batch_id` and records `batch_id` on `stock_movements`.

### Backfill
For every existing `stock_balances` row, create an `OPENING` batch (no expiry) and stamp its `batch_id` so balances reconcile. New batch entry is only *required* for products with `track_batches = true` going forward.

### Posting-RPC changes (each touches one entry/exit point)
- **Purchase invoice** = where batch + expiry are **captured**. Line gains `batch_no` / `mfg_date` / `expiry_date`; RPC upserts the `batches` row and passes `batch_id`.
- **Sale / sale-return / transfer / stock-count / claim** = **consume** a batch. Sale defaults to **FEFO** (first-expiry-first-out) via a helper `public.get_available_batches(product_id, warehouse_id)` returning batches ordered by `expiry_date`.
- `LineItemDraft` (`src/lib/types/trading.ts`) gains optional `batch_id` / `expiry_date`; `line-items-editor.tsx` gets a batch picker shown only when `track_batches`.

### Near-expiry
- Report `src/app/(app)/reports/expiry/page.tsx` — batches expiring within N days, with qty and value.
- Feed the existing alerts system: extend `refresh_company_alerts` (used by `alerts-menu.tsx`) to raise near-expiry alerts.

### ⚠️ Offline/field caveat
Field sales post through `create_sale_invoice` via the offline sync-engine. A batch **picker** can't run offline without cached batch data. **Recommendation:** for field sales, auto-assign FEFO **server-side** at sync time (no offline batch UI), and only show manual batch selection on the online office sale screen.

### Sub-phases
1. Schema (`batches`, flag, `batch_id` columns, `apply_stock_delta` arg, unique index).
2. Backfill OPENING batches.
3. Purchase capture (entry point).
4. Sale/return/transfer selection + FEFO helper.
5. Near-expiry report + alerts.
6. Wire Feature 1 expiry claims to pick expired batches.

### Effort
**Large.** Touches the stock engine + every trading RPC + trading UI. Should be shipped sub-phase by sub-phase.

---

## Cross-cutting

- **Document numbering:** three new `next_document_no` doc types — `stock_count`, `principal_claim`, and (if added) a `claim` move type. Confirm the numbering config table accepts new keys.
- **Audit:** your PRD wants an audit log on financial docs (not yet built). These posting RPCs are a good place to add it later; out of scope here.
- **Testing checklist per feature:** post → verify `stock_balances` delta, verify `stock_movements` row, verify `post_ledger` entry, verify RLS blocks a user from another company, verify cancel/edit path.

## Recommended sequence & effort

| Order | Feature | Effort | Depends on |
|-------|---------|--------|-----------|
| 1 | Physical Stock Count & Adjustment | Small–Medium | Step 0 |
| 2 | Principal Claims (product-level) | Medium | Step 0 |
| 3 | Batch & Expiry (sub-phased) | Large | Step 0 |
| 4 | Retro-fit expiry claims onto batches | Small | 2 + 3 |

## Open decisions for you

1. **Stock-count valuation** — post the gain/loss JV now, or ship quantity-only first? (Recommend: quantity-only first.)
2. **Dedicated `'claim'` stock move type** vs. reuse `'adjustment'`? (Recommend: add `'claim'` for cleaner reports.)
3. **Claim accounting head** — confirm the contra head with your accountant (Dr supplier / Cr ?).
4. **Batch scope** — which product categories actually need batch/expiry (cosmetics/food/pharma), so we can pilot the flag on those first?
5. **Field sales + batches** — accept server-side FEFO auto-assign for salesmen (recommended), or require batch on field too?
