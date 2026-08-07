# Umar Distributor System — Product Requirements Document

> **Version:** 1.0  
> **Date:** 7 August 2026  
> **Stack:** Next.js (or similar) + Supabase + Offline-first local DB  
> **Purpose:** Modern replacement for the existing local *Accounts & Inventory Management System* used by Pakistan market distributors (e.g. Umer Cosmetics, Layyah).  
> **Status:** For client review before development starts.

---

## 1. Executive Summary

The client currently runs a legacy Windows desktop app (**Accounts & Inventory Management System**) for daily distribution work: parties (shops/vendors), products, sales/purchase invoices, vouchers, stock, warehouses, and printable reports.

They want a **professional multi-company distribution ERP** with:

| Priority | Requirement |
|----------|-------------|
| UI/UX | Modern pro design — sidebar + nested dropdowns (not old grey top menus) |
| Multi-company | One login can manage **separate businesses** (e.g. Ishaq Limited, Umar Cosmetic) with **no data conflict** |
| Super Admin | Platform owner can create/link distributor accounts and control the system |
| Offline-first | Work **all day offline**; at night connect internet and **sync to cloud** |
| Salesman app | Field users record sales, recoveries, credits on their login; data syncs to main dashboard |
| Credit / recovery | Full shop outstanding (Dr/Cr) tracking — replace paper *Recovery Sheet* |
| Reports | Filterable reports with **print + download** (PDF/Excel) |
| Backend | **Supabase** (Auth, Postgres, RLS, Storage, Realtime where needed) |

---

## 2. Business Context (from current software)

### 2.1 Current product

- Name: **Accounts & Inventory Management System**
- Sample business: **Umer Cosmetics**, Lalli Lale Road, Layyah
- Local single-PC / LAN style usage; no proper multi-company cloud model
- UI: dated grey WinForms-style menus and icon toolbars

### 2.2 Current main modules (observed)

| Menu | Features |
|------|----------|
| **New / masters** | Chart of Account (parties), New Product |
| **Inventory** | Sale Invoice, Edit Sale Invoice, Sale Return, Edit Sale Return, Purchase Invoice, Edit Purchase Invoice, Purchase Return, Edit Purchase Return, Stock Transfer, Item Movement, Profit Valuation, ReOrder Level |
| **Vouchers** | Cash Receipt, Edit Cash Receipt, Cash Payment, Edit Cash Payment, Journal Voucher, Edit Journal Voucher |
| **Reports** | Sale Report, Purchase Report, Stock Report, Accounts Report |
| **Session** | Log Off, Exit |

### 2.3 Pain points

- Old UI / hard to learn and slow for new staff  
- One installation ≈ one company; managing multiple brands is awkward  
- No proper field salesman digital workflow (recovery sheets are printed + handwritten)  
- No reliable central cloud backup / multi-device access  
- No super-admin control for linked distributors  

---

## 3. Roles & Access Model

### 3.1 Role hierarchy

```
Super Admin (platform owner)
 └── Distributor Organization (e.g. "Client Group")
      ├── Company A — Ishaq Limited
      ├── Company B — Umar Cosmetic
      └── Company C — (any future business)
           ├── Company Admin / Owner
           ├── Office Staff (accountant, warehouse, etc.)
           └── Salesman (field)
```

### 3.2 Super Admin

- Create / suspend / delete **distributor organizations**
- Create multiple **companies** under one organization (same feature set, isolated data)
- Assign organization owners / admins
- View high-level system health, sync status, billing plans (if applicable)
- Optional: allow selective **cross-company sync/copy** of catalogs (products, warehouses) when client enables it
- Global settings (currency PKR default, date formats, languages)

### 3.3 Organization Admin (distributor owner)

- Manages their own companies (Ishaq Limited, Umar Cosmetic, …)
- **Company switcher** after login: chooses which company dashboard to open
- Creates users **scoped per company** (or multi-company access if allowed)
- Configures routes, warehouses, credit limits policies, printers, etc.
- Triggers or reviews **nightly sync** status

### 3.4 Company users (office)

| Role | Typical permissions |
|------|---------------------|
| Admin | Full company access |
| Accountant | Vouchers, ledgers, accounts reports, payments |
| Inventory | Products, stock, purchases, warehouse transfer |
| Sales desk | Sales invoices, returns, party lookup |
| Viewer | Reports only (read-only) |

### 3.5 Salesman

- Separate simplified **mobile-friendly** dashboard
- Assigned routes / cities / shops only
- Create field sales / orders / recoveries (offline)
- See shop outstanding balances (credit)
- Cannot access other companies or full accounting unless granted
- Data syncs into the **main company dashboard** (invoices, receipts, balances)

### 3.6 Multi-company login rule (client priority)

1. User logs in with email/password (or phone OTP optional later).
2. If user has multiple companies, show **Company Selector** (cards: Ishaq Limited | Umar Cosmetic | …).
3. Selected company opens **its own dashboard** — same feature set, **separate data**.
4. Switching company is explicit (no accidental mix of parties, stock, or invoices).
5. Shared users can be assigned access only to selected companies.

---

## 4. Multi-Tenancy Rules (no conflict)

### 4.1 Data isolation

Every business record is tagged with:

- `organization_id`
- `company_id`

Isolation enforced by:

- **Supabase Row Level Security (RLS)** on all tables  
- Application queries always filter by active `company_id`  
- Offline local DB partition per company (or clear separation of local stores)

### 4.2 What stays separate by default

| Data | Separate per company? |
|------|------------------------|
| Parties / shops / vendors | Yes |
| Products, rates, stock | Yes |
| Warehouses | Yes |
| Invoices, returns | Yes |
| Vouchers, ledgers | Yes |
| Salesmen & recoveries | Yes |
| Reports | Yes |
| Users | Shared at org level; access grants per company |

### 4.3 Optional shared / sync between companies

Client may later enable **controlled sync** (not auto-merge):

- Copy product catalog A → B  
- Shared party list (opt-in)  
- Consolidated report across companies (read-only rollup for owner)  

Default = **fully separate**. No accidental sharing.

---

## 5. Offline-First & Nightly Sync (critical)

### 5.1 Work mode

| Time | Mode |
|------|------|
| Day (shop / office / market) | **Offline-first** — full CRUD against local store |
| Night / closing | Connect internet → **Sync to Supabase** |
| After sync | Local store marked up-to-date; conflicts reported |

### 5.2 Sync design principles

- **Offline-first UX**: create invoices, recoveries, vouchers without internet
- Local DB options (to decide in tech design): SQLite / IndexedDB / PowerSync / ElectricSQL / custom queue
- Every local change gets:
  - `local_id` + later `server_id`
  - `created_at`, `updated_at`
  - `sync_status`: `pending` | `synced` | `conflict` | `failed`
- Sync engine:
  1. Push local pending mutations (ordered by timestamp)
  2. Pull remote changes since last sync
  3. Resolve conflicts (last-write-wins **or** admin review for critical financial docs)
  4. Write audit log of sync session

### 5.3 Night closing workflow

1. Operator clicks **Sync Now** (or auto when internet detected).
2. Progress UI: pending count, success, conflicts, errors.
3. Printable **Day Closing Summary** after successful sync:
   - Sales total (cash / credit)
   - Recoveries total
   - Purchases
   - Cash in hand movement
   - Pending items if any
4. Salesman devices also sync when phone has network (not only night office PC).

### 5.4 Conflict policy (recommended defaults)

| Record type | Policy |
|-------------|--------|
| New invoices / vouchers | Usually create both; never silently drop |
| Stock qty | Server recalculates from movement ledger when possible |
| Product master edits | Last-write-wins + history |
| Party balance | Derived from ledgers; not free-edited if possible |

---

## 6. Navigation & Pro UI/UX

### 6.1 Layout

- **Left sidebar** (collapsible)
- **Main sections with nested submenus** (accordion dropdowns)
- Top bar: company name, company switcher, sync status, user menu, notifications
- Keyboard shortcuts for power users (legacy had Ctrl+S, Ctrl+P)
- Clean data-entry screens (fast keyboard navigation for bill entry)
- Responsive: desktop primary; tablet/mobile for salesman

### 6.2 Proposed sidebar structure

```
📊 Dashboard
👥 Parties / Accounts
   ├─ All Parties
   ├─ Chart of Accounts
   ├─ Customers / Shops
   ├─ Suppliers / Vendors
   └─ Credit Limits & Balances
📦 Products & Inventory
   ├─ Products
   ├─ Categories / Groups / Manufacturers
   ├─ Warehouses
   ├─ Stock Levels
   ├─ Stock Transfer
   ├─ Item Movement
   ├─ Reorder Levels
   └─ Profit Valuation
🧾 Sales
   ├─ Sale Invoice
   ├─ Sale Return
   ├─ Counter / Credit Sales views
   └─ Salesmen Performance
🛒 Purchases
   ├─ Purchase Invoice
   ├─ Purchase Return
   └─ Supplier Bills
💰 Vouchers / Accounts
   ├─ Cash Receipt (CR)
   ├─ Cash Payment (CP)
   ├─ Journal Voucher (JV)
   └─ Day Book
🚶 Salesman
   ├─ Users & Routes
   ├─ Field Orders / Invoices
   ├─ Recovery Collections
   └─ Route Sheets
📈 Reports
   ├─ Sale Reports
   ├─ Purchase Reports
   ├─ Stock Reports
   ├─ Accounts Reports
   ├─ Recovery Sheet
   └─ Day Closing
⚙️ Settings
   ├─ Company Profile
   ├─ Users & Roles
   ├─ Print Templates
   ├─ Offline / Sync
   ├─ Tax / NTN basics
   └─ Number Series
```

### 6.3 Design direction

- Professional B2B operations UI (not consumer marketing)
- High contrast forms for long daily use
- Dense but readable tables for invoices (power-user accounting feel)
- Status chips for sync: Online / Offline / Syncing / Conflicts
- Urdu labels support where needed on parties/products (keep bilingual fields)
- Currency: **PKR**, number formats for Pakistani market

---

## 7. Feature Modules (detailed)

### 7.1 Dashboard (company-scoped)

- Today’s sales (cash vs credit)
- Recoveries collected today
- Outstanding receivables (top shops)
- Low stock / reorder alerts
- Pending offline sync count
- Salesman activity summary
- Quick actions: New Sale, Cash Receipt, New Party, Sync

---

### 7.2 Parties / Chart of Accounts

**From current form: Chart of Account**

| Field | Description |
|-------|-------------|
| Party Code | Auto or manual unique code |
| Date | Opening / create date |
| Party Name (English) | Required |
| Party Name (Urdu) | Optional bilingual |
| Party Type | ASSETS, CAPITAL, EXPENSES, INCOME, PARTY (Customer/Supplier subtypes) |
| Address / Sub Head | Address or accounting sub-head |
| City / Head | City or parent head |
| Phone / Mobile | Contact |
| Contact Person | Optional |
| NTN | Pakistan National Tax Number |
| Opening Balance | Debit/Credit rules (negative amount for debit/receivable as in current) |
| Credit Limit | Max outstanding allowed |
| Sale type | Retail / Wholesale |
| Route | For salesman & recovery sheet grouping |
| Active flag | Soft disable |

**Actions:** Add, Edit, Delete (guard if transactions exist), Search by city/name/code, Print party list.

---

### 7.3 Products

**From current form: Add New Product**

| Field | Description |
|-------|-------------|
| Code | Unique product code |
| Name (Eng) | Product name |
| Name (Urdu) | Optional |
| Type | e.g. Hair Colour |
| Manufacturer / Brand | e.g. KEUNE |
| Group / Category | e.g. Hair Color |
| Warehouse (default) | Default stock location |
| Retail Rate | MRP / retail |
| Purchase Rate (P.R.) | Cost |
| Wholesale Rate (W.S.R.) | Wholesale |
| Sale Rate / Print Rate | Trade rates |
| Scheme | Bundle/scheme info |
| Barcode | Optional |
| Opening Qty / Opening Rate | Opening stock |
| Reorder Level | Alert threshold |
| Packing | Pack size (e.g. 24) |
| Rate Slab | Qty From–To → Rate (tier pricing) |

**Actions:** CRUD, bulk import (CSV), search by code/name/barcode, print barcodes (phase 2).

---

### 7.4 Warehouses & stock

- Multiple warehouses / brands locations (current examples: CITY GIRL, KEUNE, FAUJI CEREALS, DERMACOS, …)
- **Warehouse Transfer Note**: From warehouse → To warehouse, line items (code, description, qty)
- **Item Movement** history
- **Reorder Level** report/alerts
- **Profit Valuation** (cost vs sale)
- Stock never allowed negative unless setting enables it

---

### 7.5 Sales

#### Sale Invoice

- Invoice no (auto series per company)
- Date, warehouse
- Party / shop
- Salesman (optional)
- Route / city (auto from party)
- Line items: code, name, qty, rate, discount, scheme, amount
- Cash / Credit / Partial
- Payment received amount → auto link cash receipt if needed
- Print invoice (thermal / A4 templates)
- Edit with audit trail (who changed, when)

#### Sale Return

- Against invoice or free return (configurable)
- Restores stock
- Adjusts party balance

---

### 7.6 Purchases

#### Purchase Invoice

- Supplier, date, bill no, warehouse
- Line items with purchase rate
- Updates stock & payable

#### Purchase Return

- Reverse purchase stock/payable

---

### 7.7 Vouchers (Accounting)

| Voucher | Purpose |
|---------|---------|
| **Cash Receipt (CR)** | Money received from party; multi-line grid (code, party, amount, narration); print |
| **Cash Payment (CP)** | Money paid out; multi-line; print |
| **Journal Voucher (JV)** | Debit account(s) ↔ Credit account(s); amount; narration |

- Vr. No auto series  
- Date locked rules optional  
- Edit / cancel with permissions  
- Narration free text  
- Totals always balanced on JV  

---

### 7.8 Credit / Recovery system (client priority)

Replaces physical **Recovery Sheet**:

- Per shop **balance** as Dr (receivable) / Cr (advance) / Nil  
- Recovery sheet by **City / Route / Head** + date  
- Columns: Code | Name | Balance | Recovery | Remarks  
- Salesman app: enter recovery amount + notes offline  
- Office print **Recovery Sheet** for field if still needed  
- Credit limit warning on sale invoice if shop exceeds limit  
- Aging: current / 30 / 60 / 90+ days (accounts report style)

---

### 7.9 Salesman module

| Capability | Detail |
|------------|--------|
| User create | Company admin creates salesman login |
| Assign route | Cities / heads / party list |
| Field dashboard | Today targets, route shops, balances |
| Record sale / order | Create sale or booking at shop |
| Record recovery | Amount collected per shop |
| Offline | Full day offline; sync when online |
| Sync to main | Appears in company sales, CR, balances |
| Report | Salesman-wise sales report (already exists in old system) |

---

### 7.10 Reports (print + download)

All reports support: filters, preview, **Print**, **PDF download**, **Excel export** (where table-based).

#### A) Sale Reports

- Manufacturer / Category wise  
- Date wise Counter Sales  
- Date wise Credit Sales  
- Bill # From–To  
- Item / Party wise sale detail  
- **Salesman wise** sales  
- Head / City sales (+ sale summary)  
- Route wise sales  
- Sale chart (visual)  
- Cash flow (sales side)  
- Sale profit  

#### B) Purchase Reports

- Supplier / Manufacturer wise  
- Bill wise (bill range)  
- Purchase Summary  
- Purchase Detail (filters: Head/City, Party, Group, Item)  

#### C) Stock Reports

- Stock List  
- Manufacturer / Supplier stock  
- P/L Detail  
- Stock Analysis Qty  
- Stock Analysis Value  
- Stock Analysis Detail  

#### D) Accounts Reports

- Accounts List  
- Account List Head Wise  
- Trial Balance  
- Balance Sheet  
- Receivable (Debit) accounts / Payable (Credit) accounts  
- With Recovery option  
- Cash Flow  
- Voucher Detail (CP / CR / JV / ALL)  
- Party Ledger (small ledger option)  
- Head wise Aged Recovery (+ balance only)  

#### E) Extra (modern additions)

- Day Closing Pack  
- Salesman Recovery Report  
- Sync / Offline Audit Log  
- Multi-company consolidated summary (owner only, optional)  

---

### 7.11 Printing

- Invoice templates (A4 + 80mm thermal)
- Voucher print
- Recovery sheet print
- Party ledger print
- Browser print dialog + silent printer preferences later
- Company logo, name, address, NTN on documents

---

## 8. Super Admin Portal Features

| Feature | Description |
|---------|-------------|
| Organizations | Create distributor orgs |
| Companies under org | e.g. Ishaq Limited, Umar Cosmetic |
| Subscription / status | Active, suspended |
| Users | Link org admins |
| Impersonation (optional) | Support login for troubleshooting |
| System metrics | Active companies, last sync, storage |
| Global defaults | Templates, currency |

---

## 9. Authentication & Security

- Supabase Auth (email/password; optional phone later)
- Invite users by email
- Password reset
- Role-based access control (RBAC)
- RLS on every table by `company_id` + role claims
- Session timeout for office PCs
- Audit log: create/edit/delete on financial documents
- Soft delete preferred for financial history

---

## 10. Technical Architecture (high level)

### 10.1 Recommended stack

| Layer | Choice |
|-------|--------|
| Frontend | Next.js (App Router) + TypeScript |
| UI | Tailwind + component library (clean pro ops design) |
| Backend / DB | **Supabase Postgres** |
| Auth | **Supabase Auth** |
| Files | Supabase Storage (logos, export files) |
| Offline | Local DB + sync queue (PowerSync **or** custom IndexedDB/SQLite + edge functions) |
| Deploy | Vercel / similar + Supabase project |

### 10.2 Core tables (indicative)

```
organizations
companies
profiles / users_meta
company_members (user_id, company_id, role)
parties (chart of accounts)
party_types / heads / cities / routes
products
product_rate_slabs
warehouses
stock_balances
stock_movements
sale_invoices + sale_invoice_items
sale_returns + items
purchase_invoices + items
purchase_returns + items
vouchers + voucher_lines (CR/CP/JV)
ledger_entries (derived or dual-write)
salesman_assignments
recoveries
document_series
sync_events / sync_conflicts
audit_logs
print_templates
settings
```

### 10.3 Supabase features to use

- Auth + JWT custom claims (`organization_id`, `role`)
- Postgres + RLS policies
- Database functions / Edge Functions for posting stock/ledger
- Realtime optional for multi-office when online
- Storage for PDFs/logos
- Migrations via Supabase CLI

---

## 11. Pakistan Market Specifics

- Currency: **PKR**
- Supports **NTN**, mobile numbers local format
- Bilingual party/product names (English + Urdu)
- Cities / routes oriented recovery (Layyah, Chowk Azam, etc.)
- Distribution brands / multi-warehouse common in cosmetics / FMCG
- Cash-heavy daily operations + credit shops culture
- Printable recovery sheets still useful even after digital salesman app

---

## 12. Implementation Phases (suggested)

### Phase 1 — Foundation
- Super Admin + Org + Company multi-tenancy  
- Auth, roles, company switcher  
- Parties, Products, Warehouses  
- Basic dashboard + pro sidebar UI  
- Supabase schema + RLS  

### Phase 2 — Core trading
- Sale Invoice / Return  
- Purchase Invoice / Return  
- Stock transfer + stock reports  
- Print templates  

### Phase 3 — Accounts
- CR / CP / JV  
- Party ledger, trial balance, receivables  
- Recovery sheet + credit limits  

### Phase 4 — Offline + Salesman
- Offline local store + sync engine  
- Night closing workflow  
- Salesman mobile UI  
- Field recovery + route sheets  

### Phase 5 — Advanced reports & polish
- All report variants from legacy  
- PDF/Excel exports  
- Optional cross-company sync tools  
- Performance hardening  

---

## 13. Success Criteria

- [ ] Staff prefer new UI over old software for daily entry  
- [ ] One owner manages multiple companies without data bleed  
- [ ] Full day offline work works without data loss  
- [ ] Night sync completes with clear status & conflict handling  
- [ ] Salesman recoveries appear correctly in main accounts  
- [ ] Recovery sheet and invoices print cleanly  
- [ ] All major legacy features covered (or explicitly deferred with client sign-off)  

---

## 14. Out of Scope (until client asks)

- Full FBR e-invoicing / SRB integration  
- POS barcode scanning hardware drivers (can add later)  
- Payroll / HR  
- Manufacturing production MRP  
- Multi-currency international beyond PKR  

---

## 15. Open Questions for Client Sign-off

1. **App type for offline:** Browser PWA only, or also Windows desktop (Electron) for shop PCs?  
2. **Conflict rule:** auto last-write-wins, or admin must approve invoice conflicts?  
3. **Salesman creates final invoices or orders only** (office confirms later)?  
4. **Migrate old data** from current software? If yes, which DB/export is available?  
5. **Urdu UI** fully or bilingual fields only?  
6. How many companies and concurrent users at go-live?  
7. Any features from old system they **do not** want to keep?  

---

## 16. Feature Checklist (quick reference)

### Master data
- [x] Chart of accounts / parties  
- [x] Products + rate slabs  
- [x] Warehouses / brands stock locations  
- [x] Cities / routes / heads  
- [x] Users & roles  

### Trading
- [x] Sale invoice + edit  
- [x] Sale return + edit  
- [x] Purchase invoice + edit  
- [x] Purchase return + edit  
- [x] Stock transfer  
- [x] Item movement  
- [x] Reorder level  
- [x] Profit valuation  

### Finance
- [x] Cash receipt  
- [x] Cash payment  
- [x] Journal voucher  
- [x] Credit limits  
- [x] Recovery sheet + collections  

### Multi-company & admin
- [x] Super admin  
- [x] Multiple companies per distributor (same features, isolated data)  
- [x] Company selector at login/dashboard  
- [x] Optional selective sync between companies  

### Mobile / field
- [x] Salesman users  
- [x] Field sales / recovery  
- [x] Offline capture + sync to main  

### Platform
- [x] Offline-first day work  
- [x] Nightly / on-demand cloud sync (Supabase)  
- [x] Pro sidebar UI  
- [x] Print + PDF reports  
- [x] Excel export (reports)  

---

## 17. Next Step

After you review this document:

1. Confirm / mark any changes (add/remove modules).  
2. Answer open questions in **Section 15**.  
3. Approve Phase 1 scope.  
4. Development starts: Supabase project scaffold + multi-company auth + pro shell UI.

---

*Document prepared from legacy UI screenshots (Inventory, Vouchers, Chart of Account, Warehouse Transfer, Cash Receipt/Payment, Journal Voucher, Sale/Purchase/Stock/Accounts Reports, Product form, Recovery Sheet) plus client requirements for multi-company, offline sync, salesman, and professional UX with Supabase.*
