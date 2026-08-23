# Phase 4 — Backend Wiring Spec

> Turns the Phase 3 frontend/engine work into posted, ledger-affecting behavior.
> Each section is written so the change is **mechanical** once the schema dump lands.

## 0. Why this doc exists (the one hard blocker)

Umar is **RPC-driven**: all business logic lives in Postgres `SECURITY DEFINER`
functions called via `supabase.rpc(...)`. The posting functions
(`create_sale_invoice`, `create_purchase_invoice`, `create_stock_transfer`,
`create_load_sheet`, `create_sale_return`, `create_purchase_return`) each take a
single `p_payload jsonb` argument and fan it out into the header + item tables and
the ledger.

**Those function bodies are NOT in the repo** — they exist only in the database.
Changing any posting behavior therefore requires editing *both* the client payload
(this repo) *and* the RPC body (the DB). Before starting Phase 4, pull the real
schema + function bodies:

```bash
# project ref: hrupolfaycvjakcvwkcr
npx supabase login
npx supabase link --project-ref hrupolfaycvjakcvwkcr
npx supabase db dump --linked --schema public,private -f supabase/schema.sql
# function bodies specifically:
npx supabase db dump --linked --schema public,private --schema-only -f supabase/schema.sql
```

Commit `supabase/schema.sql` so the RPC bodies are reviewable and every change
below can be written as a concrete migration.

## Design invariants (do not break)

1. **Additive JSON keys are safe.** The payload is `jsonb`; a function that reads
   keys with `->>` ignores unknown ones. New keys can ship in the client *before*
   the RPC reads them without breaking existing posts — but they have no effect
   until the RPC is updated. Ship the migration + RPC first, then the client.
2. **`line.amount` stays the pre-tax net** (`qty*rate - discount`). Tax is a
   header roll-up plus optional per-line tax columns for the FBR invoice — never
   folded into `amount`, or every downstream total double-counts.
3. **Engines are the single source of truth** for the math. The client fills the
   payload from `src/lib/pricing/{uom,discounts,tax}.ts`; the RPC re-derives and
   validates server-side (never trust client totals for the ledger).
4. **Migrations are backfill-safe**: every new column is `NULL`/`DEFAULT`-able so
   existing rows and in-flight documents keep posting.

---

## 1. Tax (FBR GST / further tax / FED)

**Engine:** `src/lib/pricing/tax.ts` — `computeLineTax`, `computeInvoiceTax`,
`DEFAULT_GST_RATE = 18`, `DEFAULT_FURTHER_TAX_RATE = 3`.

**DB migration**

```sql
-- product tax profile
alter table products
  add column gst_rate numeric(5,2) default 18,   -- per-item override; NULL = exempt
  add column fed_rate numeric(5,2) default 0;

-- header roll-up (repeat for purchase_invoices)
alter table sale_invoices
  add column taxable_total numeric(14,2) default 0,
  add column gst_total     numeric(14,2) default 0,
  add column further_tax_total numeric(14,2) default 0,
  add column fed_total     numeric(14,2) default 0,
  add column tax_total     numeric(14,2) default 0,   -- gst+further+fed
  add column tax_inclusive boolean default false;

-- per-line detail (repeat for purchase_invoice_items)
alter table sale_invoice_items
  add column gst_rate numeric(5,2) default 0,
  add column gst_amount numeric(14,2) default 0,
  add column fed_amount numeric(14,2) default 0;
```

`grand_total` semantics change to **`taxable_total + tax_total`**. Keep `subtotal`
and `discount_total` as-is (pre-tax) so existing reports still reconcile.

**Client payload additions** (`sale-invoice-form.tsx`, `purchase-invoice-form.tsx`)

Header: `taxable_total`, `gst_total`, `further_tax_total`, `fed_total`,
`tax_total`, `tax_inclusive`.
Each `items[]` entry: `gst_rate`, `gst_amount`, `fed_amount`.

Compute with `computeInvoiceTax(lines.map(l => ({ taxableValue: l.amount, gstRate: product.gst_rate, furtherTaxRate: buyerUnregistered ? 3 : 0, fedRate: product.fed_rate, inclusive })))`.
`buyerUnregistered` comes from a new `parties.tax_registered boolean` (further tax
applies only to unregistered buyers).

**RPC change** (`create_sale_invoice`): read the new header keys into the new
columns; per item read `gst_rate/gst_amount/fed_amount`; **re-derive** the tax
server-side from `products.gst_rate` and compare to the client value (reject on
mismatch beyond a 1-paisa tolerance). Post `gst_total` to the FBR **output-tax
payable** ledger account, not to the party/sales account.

**Print/report impact:** `PrintDocument` totals block gains Taxable / GST / Further
/ FED / Grand rows (only render when non-zero — the existing auto-hide pattern).
Add a company NTN/STRN line (already supported) for a compliant tax invoice.

---

## 2. UOM (carton ⇄ piece) persistence

**Engine:** `src/lib/pricing/uom.ts` — already wired into the editor as
piece-based `qty` (backward-compatible). This section only *persists the operator's
chosen unit* so documents can reprint "2 CTN + 3 PCS" and reports can group by carton.

**DB migration**

```sql
alter table sale_invoice_items
  add column entry_unit text default 'pcs'      -- 'pcs' | 'ctn'
    check (entry_unit in ('pcs','ctn')),
  add column entry_qty numeric(14,3),           -- qty as the operator typed it
  add column pieces_per_carton numeric(12,3);   -- snapshot of product.packing at post time
-- qty stays the canonical PIECES value; the above are display/audit only.
```

Snapshot `pieces_per_carton` at post time so a later `products.packing` edit can't
retro-change historical documents.

**Client payload additions:** per item `entry_unit`, `entry_qty`,
`pieces_per_carton`. The editor already knows the packing; add an `entry_unit`
toggle state per line (default `pcs`). `qty` sent to the RPC is unchanged
(`toPieces(...)` result).

**RPC change:** store the three new fields verbatim; **all stock/ledger math stays
in pieces** — no posting logic changes. Purely additive.

**Print/report impact:** `PrintDocument` line renderer shows
`formatUom(qty, pieces_per_carton)` when `entry_unit='ctn'`. Stock report can add a
"Cartons" column via `piecesToCartons`.

---

## 3. Structured schemes (replace free-text `scheme`)

**Engine:** `src/lib/pricing/discounts.ts` — `parseScheme`, `applyScheme`,
`computeLineScheme`. The payload's `items[].scheme` string is already sent; today
it is stored and **never applied**.

**DB migration**

```sql
-- optional: structured scheme catalog (else keep parsing the string at post time)
alter table sale_invoice_items
  add column scheme_kind text,          -- 'percent'|'flat'|'per_unit'|'free_goods'|'none'
  add column scheme_free_qty numeric(14,3) default 0,
  add column scheme_discount numeric(14,2) default 0;

-- free goods need a stock movement without revenue:
alter table sale_invoice_items
  add column is_free_goods boolean default false;
```

**Client payload additions:** per item `scheme_kind`, `scheme_free_qty`,
`scheme_discount`. Compute via `computeLineScheme(line.scheme, qty, rate)`. For
percent/flat/per-unit, also fold `scheme_discount` into the existing `discount`
field so `amount` already reflects it. For `free_goods`, keep `discount` = 0 and
emit a **second item row** with `is_free_goods=true`, `rate=0`,
`qty=scheme_free_qty` (so inventory decrements the bonus units at zero revenue).

**RPC change** (`create_sale_invoice`): (a) re-derive scheme via a Postgres port of
`applyScheme` (or trust client but validate `scheme_discount <= qty*rate`);
(b) for free-goods rows, post the COGS/stock movement but zero sales revenue;
(c) FBR note: free goods are still a **taxable supply at open-market value** — feed
`scheme_free_qty * rate` into the tax base from §1.

**Print/report impact:** free-goods rows print with "FREE" in the amount cell;
scheme label (`result.label`) shows in a per-line note.

---

## 4. Batch / expiry

**DB migration**

```sql
create table product_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  product_id uuid not null references products(id),
  batch_no text not null,
  expiry_date date,
  mfg_date date,
  received_qty numeric(14,3) not null default 0,
  cost_rate numeric(14,2),
  created_at timestamptz default now(),
  unique (company_id, product_id, batch_no)
);
alter table sale_invoice_items    add column batch_id uuid references product_batches(id);
alter table purchase_invoice_items add column batch_no text, add column expiry_date date;
-- stock ledger must carry batch_id to compute batch-wise on-hand + near-expiry.
alter table stock_ledger add column batch_id uuid references product_batches(id);
```

**Client payload additions:** purchase items gain `batch_no`, `expiry_date`,
`mfg_date`; sale items gain `batch_id` (chosen from available batches, FEFO-suggested
= First-Expiry-First-Out).

**RPC change:** `create_purchase_invoice` upserts `product_batches` and stamps
`stock_ledger.batch_id`; `create_sale_invoice` decrements the chosen batch and
**blocks selling an expired batch** (raise exception). Add
`get_batches_for_product(company, product, warehouse)` for the picker and a
`near_expiry_report(company, days)` for the new report.

**Print/report impact:** new **Near-Expiry report** (reuse `ReportTable` +
`.report-print`); invoice line optionally prints `Batch / Exp mm-yy`.

---

## 5. Mixed tender / multi-payment

Today the header carries a single `payment_type` (`cash|credit|partial`) +
`amount_paid`. Distribution collections are often split (part cash, part
easypaisa/JazzCash, part credit).

**DB migration**

```sql
create table payment_splits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  doc_type text not null,          -- 'sale_invoice' | 'recovery' | ...
  doc_id uuid not null,
  method text not null,            -- 'cash'|'card'|'easypaisa'|'jazzcash'|'bank'|'cheque'|'credit'
  amount numeric(14,2) not null,
  reference text,                  -- txn id / cheque no
  created_at timestamptz default now()
);
```

Keep `payment_type`/`amount_paid` for backward-compat: derive `payment_type` from
the splits (all-cash → `cash`, none → `credit`, else `partial`) and set
`amount_paid = sum(non-credit splits)`.

**Client payload additions:** `payments: [{ method, amount, reference? }]`. Replace
the single amount-paid input with a small splits editor (new component
`payment-splits-editor.tsx`); when the user leaves it as one cash row, behavior is
identical to today.

**RPC change:** `create_sale_invoice` inserts `payment_splits`, routes each method
to its ledger account (cash-in-hand vs bank vs wallet clearing), and posts the
credit remainder to the party. Validate `sum(payments) + credit_remainder = grand_total`.

**Print/report impact:** invoice footer lists tender split; new **Daily cash /
tender summary** report (by method) via `ReportTable`.

---

## 6. Rollout order & verification

Recommended sequence (lowest posting-risk first):

1. **UOM persistence** (§2) — no ledger math change; pure display columns.
2. **Tax** (§1) — highest business value; changes `grand_total` semantics, so do
   it before schemes/tender that depend on the taxed total.
3. **Structured schemes** (§3) — depends on the tax base for free-goods valuation.
4. **Mixed tender** (§5) — depends on final `grand_total`.
5. **Batch/expiry** (§4) — largest surface; can proceed in parallel, ships last.

**Per-change verification (no test framework in repo):**

- Port each engine's assertions into a Postgres test (pgTAP or a `do $$ ... $$`
  block) so client and server agree to the paisa. The 60 TS assertions in
  `outputs/engine-tests.ts` are the reference vectors.
- Round-trip test: post via RPC on a staging company → re-read the row → assert
  header totals == `computeInvoiceTax`/`summarizeLines` on the same input.
- Reconciliation query after each post: `sales = Σ line net`,
  `gst_total = Σ line gst`, `ledger debits = ledger credits`.
- Re-run project `tsc --noEmit` and `eslint` on every touched client file.

**Definition of done for Phase 4:** a sale with mixed UOM entry, a percentage +
free-goods scheme, GST + further tax, batch selection, and split tender posts
cleanly; Inventory, Party Ledger, Tax Payable, and the Sales report all reconcile;
and the printed invoice is FBR-compliant.
