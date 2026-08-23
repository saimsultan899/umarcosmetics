# Umar Distribution Software

Modern multi-company distribution ERP for the Pakistan market (replacement for the legacy Accounts & Inventory Management System).

**Supabase project:** `Umar Distribution Software`  
**Org ref:** `cxuvawvbjxerhckgakga`  
**Project ref:** `kbkgffdskjedtrpebcyk`  
**URL:** https://kbkgffdskjedtrpebcyk.supabase.co

## Phase 1 (live)

- Super Admin + Organizations + Companies (multi-tenant)
- Auth, company switcher, isolated company dashboards
- Parties / Chart of Accounts CRUD
- Products CRUD
- Warehouses CRUD
- Pro sidebar UI with nested menus
- Schema + RLS pushed to Supabase

## Phase 2 (live)

- Sale Invoice + Sale Return (stock out / in)
- Purchase Invoice + Purchase Return (stock in / out)
- Warehouse Transfer Note
- Auto document numbers (SI-/SR-/PI-/PR-/ST-)
- Stock balances + movement history report
- Printable A4 document views for invoices/returns/transfers

## Phase 3 (live)

- Cash Receipt (CR), Cash Payment (CP), Journal Voucher (JV)
- Party ledger from sales/purchases/vouchers
- Receivable / payable accounts reports
- Recovery sheet (Dr/Cr) + record recovery → posts CR
- Credit limit warnings on sale invoices

## Phase 4 (live)

- Salesman invites + route/city assignment
- Mobile field app (`/field`) for shops, recovery, quick sale
- Offline queue (IndexedDB) for recovery & sales
- Topbar online/offline + pending sync
- Night closing summary + sync sessions
- Printable route sheets

## Phase 5 (live)

- Full sale report suite (date/cash/credit/party/item/city/route/salesman/profit/cashflow)
- Purchase report suite (summary/bill/supplier/detail/item/manufacturer)
- Stock list / analysis / movements with export
- Accounts receivable/payable/ledger with Excel/CSV/Print
- Optional cross-company product catalog copy (same org)

## Modern ops suite (live)

- Command-center dashboard (today sales/recovery, credit risk, low stock, 7-day trend)
- Module stats cards + charts (sales, purchases, parties, products, recovery, aging, accounts, stock, field)
- Smart alerts bell (credit limit + reorder notifications)
- Global search (`Ctrl/Cmd + K`) across parties, products, invoices
- Receivable aging report with chase list
- Party intelligence pages (balance, credit utilization, last rates, history)
- Van load sheets (issue stock to salesman vehicles)
- Last-sold-rate auto-fill on sale invoices
- PWA install (manifest + icons) for desktop/mobile home-screen use
- Offline sync status wired into the topbar

## Quick start

```bash
npm install
cp .env.example .env.local   # already filled for this project if using local clone
npm run dev
```

Open http://localhost:3000

### First-time bootstrap

1. In Supabase Dashboard → **Authentication → Providers → Email**  
   Turn **off** “Confirm email” (for local/dev bootstrap).
2. Open http://localhost:3000/setup
3. Create Super Admin → seeds:
   - Organization: **Umar Group**
   - Companies: **Umar Cosmetic**, **Ishaq Limited**
   - Default warehouses per company
4. Login → choose company → dashboard

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |

## Docs

See [`REQUIREMENTS.md`](./REQUIREMENTS.md) for full product scope (offline sync, salesman, vouchers, reports, etc.).

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- Supabase Auth + Postgres + RLS
- Lucide icons
# umarcosmetics
