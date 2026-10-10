export type AppRole =
  | "super_admin"
  | "org_admin"
  | "company_admin"
  | "accountant"
  | "inventory"
  | "sales_desk"
  | "salesman"
  | "viewer";

export type PartyType = "ASSETS" | "CAPITAL" | "EXPENSES" | "INCOME" | "PARTY";
export type PartySubtype = "customer" | "supplier" | "both" | "other";
export type SaleChannel = "retail" | "wholesale";

export type Organization = {
  id: string;
  name: string;
  status: "active" | "suspended";
  /** When set, other companies under this org mirror products/shops here. */
  main_company_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type Company = {
  id: string;
  organization_id: string;
  name: string;
  code: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  ntn: string | null;
  logo_url: string | null;
  is_active: boolean;
  /** block = do not sell past stock. confirm = warn, then allow a short sale. */
  sale_stock_policy?: "block" | "confirm" | null;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  is_super_admin: boolean;
  organization_id: string | null;
  active_company_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CompanyMember = {
  id: string;
  company_id: string;
  user_id: string;
  role: AppRole;
  is_active: boolean;
  /** NULL follows the role template. An empty array grants nothing. */
  permissions?: string[] | null;
  created_at: string;
  updated_at: string;
  companies?: Company;
};

export type Party = {
  id: string;
  organization_id: string;
  company_id: string;
  party_code: string;
  name_en: string;
  name_ur: string | null;
  party_type: PartyType;
  party_subtype: PartySubtype;
  address: string | null;
  sub_head: string | null;
  city: string | null;
  head: string | null;
  route: string | null;
  phone: string | null;
  mobile: string | null;
  contact_person: string | null;
  ntn: string | null;
  opening_balance: number;
  credit_limit: number;
  sale_channel: SaleChannel | null;
  is_active: boolean;
  /** Linked party on the organization main company, when hub sync is on. */
  hub_party_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type Warehouse = {
  id: string;
  organization_id: string;
  company_id: string;
  name: string;
  code: string | null;
  address: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Product = {
  id: string;
  organization_id: string;
  company_id: string;
  code: string;
  name_en: string;
  name_ur: string | null;
  product_type: string | null;
  manufacturer: string | null;
  category_group: string | null;
  barcode: string | null;
  /** Full barcode list, including the first. Optional label is the flavour or variety. */
  extra_barcodes?: { barcode: string; label?: string | null }[] | null;
  /** Linked product on the organization main company, when hub sync is on. */
  hub_product_id?: string | null;
  default_warehouse_id: string | null;
  retail_rate: number;
  purchase_rate: number;
  wholesale_rate: number;
  sale_rate: number;
  print_rate: number;
  opening_rate: number;
  opening_qty: number;
  reorder_level: number;
  /** Units (base pieces) per outer pack / carton. */
  packing: number;
  /** Outer pack label: Carton, Box, Pack, … */
  unit_type?: string;
  /** Stock-keeping unit label: Piece, Pcs, Unit, … */
  base_unit?: string;
  scheme: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** System or company-custom expense type code. */
export type ExpenseCategory = string;

export type Expense = {
  id: string;
  organization_id: string;
  company_id: string;
  expense_no: string;
  expense_date: string;
  category: ExpenseCategory;
  amount: number;
  salesman_id: string | null;
  party_id: string;
  remarks: string | null;
  created_at: string;
  updated_at: string;
};
