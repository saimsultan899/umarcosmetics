-- Invoice-level extra discount on purchases (mirrors sale_invoices.extra_discount).
alter table public.purchase_invoices
  add column if not exists extra_discount numeric(14, 2) not null default 0;

comment on column public.purchase_invoices.extra_discount is
  'Invoice-level extra discount after line trade discounts; reduces payable grand_total';
