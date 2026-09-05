-- Add builty to expense categories (must commit before use in later migration).
ALTER TYPE public.expense_category ADD VALUE IF NOT EXISTS 'builty';
