-- Builty expense: company (warehouse) + vendor columns and RPC.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.parties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS expenses_company_warehouse_idx
  ON public.expenses (company_id, warehouse_id);
CREATE INDEX IF NOT EXISTS expenses_company_vendor_idx
  ON public.expenses (company_id, vendor_id);

CREATE OR REPLACE FUNCTION private.ensure_expense_head(
  p_org_id uuid,
  p_company_id uuid,
  p_category public.expense_category
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_code text;
  v_name text;
  v_id uuid;
BEGIN
  v_code := CASE p_category
    WHEN 'salary' THEN 'EXP-SAL'
    WHEN 'fuel' THEN 'EXP-FUEL'
    WHEN 'food' THEN 'EXP-FOOD'
    WHEN 'rent' THEN 'EXP-RENT'
    WHEN 'utilities' THEN 'EXP-UTIL'
    WHEN 'conveyance' THEN 'EXP-CONV'
    WHEN 'loading' THEN 'EXP-LOAD'
    WHEN 'stationery' THEN 'EXP-STAT'
    WHEN 'builty' THEN 'EXP-BUILTY'
    ELSE 'EXP-OTH'
  END;
  v_name := CASE p_category
    WHEN 'salary' THEN 'Salesman Salary'
    WHEN 'fuel' THEN 'Fuel / Petrol'
    WHEN 'food' THEN 'Daily Food'
    WHEN 'rent' THEN 'Rent'
    WHEN 'utilities' THEN 'Utilities'
    WHEN 'conveyance' THEN 'Conveyance / Travel'
    WHEN 'loading' THEN 'Loading / Labour'
    WHEN 'stationery' THEN 'Stationery / Office'
    WHEN 'builty' THEN 'Builty Expense'
    ELSE 'Other Expenses'
  END;

  SELECT id INTO v_id
  FROM public.parties
  WHERE company_id = p_company_id
    AND party_code = v_code
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.parties (
      organization_id, company_id, party_code, name_en,
      party_type, party_subtype, head, sub_head, created_by
    ) VALUES (
      p_org_id, p_company_id, v_code, v_name,
      'EXPENSES', 'other', 'Expenses', v_name, auth.uid()
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_expenses(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_date date := coalesce((p_payload->>'expense_date')::date, current_date);
  v_line jsonb;
  v_category public.expense_category;
  v_amount numeric;
  v_salesman uuid;
  v_warehouse uuid;
  v_vendor uuid;
  v_remarks text;
  v_party uuid;
  v_no text;
  v_id uuid;
  v_sm_name text;
  v_wh_name text;
  v_vendor_name text;
  v_label text;
  v_narration text;
  v_ids uuid[] := '{}';
  v_count int := 0;
BEGIN
  IF NOT private.can_write_company(v_company_id) THEN
    RAISE EXCEPTION 'No write access';
  END IF;
  IF v_org_id IS NULL OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'Company is required';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  LOOP
    v_category := (v_line->>'category')::public.expense_category;
    v_amount := coalesce((v_line->>'amount')::numeric, 0);
    v_salesman := nullif(v_line->>'salesman_id', '')::uuid;
    v_warehouse := nullif(v_line->>'warehouse_id', '')::uuid;
    v_vendor := nullif(v_line->>'vendor_id', '')::uuid;
    v_remarks := nullif(trim(coalesce(v_line->>'remarks', '')), '');

    IF v_amount <= 0 THEN
      CONTINUE;
    END IF;
    IF v_category IS NULL THEN
      RAISE EXCEPTION 'Choose an expense type for every line';
    END IF;
    IF v_category = 'salary' AND v_salesman IS NULL THEN
      RAISE EXCEPTION 'Select the salesman for salary';
    END IF;
    IF v_category = 'builty' THEN
      IF v_warehouse IS NULL THEN
        RAISE EXCEPTION 'Select the company for builty expense';
      END IF;
      IF v_vendor IS NULL THEN
        RAISE EXCEPTION 'Select the vendor for builty expense';
      END IF;
    END IF;
    IF v_salesman IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.salesmen
        WHERE id = v_salesman AND company_id = v_company_id
      ) THEN
        RAISE EXCEPTION 'Unknown salesman';
      END IF;
    END IF;
    IF v_warehouse IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.warehouses
        WHERE id = v_warehouse AND company_id = v_company_id
      ) THEN
        RAISE EXCEPTION 'Unknown company';
      END IF;
    END IF;
    IF v_vendor IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.parties
        WHERE id = v_vendor
          AND company_id = v_company_id
          AND (
            party_subtype IN ('supplier', 'both')
            OR party_type = 'PARTY'
          )
      ) THEN
        RAISE EXCEPTION 'Unknown vendor';
      END IF;
    END IF;

    IF v_category <> 'salary' THEN
      v_salesman := NULL;
    END IF;
    IF v_category <> 'builty' THEN
      v_warehouse := NULL;
      v_vendor := NULL;
    END IF;

    v_party := private.ensure_expense_head(v_org_id, v_company_id, v_category);
    v_no := public.next_document_no(v_company_id, 'expense', 'EXP-');

    INSERT INTO public.expenses (
      organization_id, company_id, expense_no, expense_date,
      category, amount, salesman_id, warehouse_id, vendor_id,
      party_id, remarks, created_by
    ) VALUES (
      v_org_id, v_company_id, v_no, v_date,
      v_category, v_amount, v_salesman, v_warehouse, v_vendor,
      v_party, v_remarks, auth.uid()
    )
    RETURNING id INTO v_id;

    SELECT full_name INTO v_sm_name
    FROM public.salesmen
    WHERE id = v_salesman;

    SELECT name INTO v_wh_name
    FROM public.warehouses
    WHERE id = v_warehouse;

    SELECT coalesce(nullif(trim(party_code), '') || ' — ', '') || name_en
      INTO v_vendor_name
    FROM public.parties
    WHERE id = v_vendor;

    v_label := CASE v_category
      WHEN 'salary' THEN 'Salesman salary'
      WHEN 'fuel' THEN 'Fuel / petrol'
      WHEN 'food' THEN 'Daily food'
      WHEN 'rent' THEN 'Rent'
      WHEN 'utilities' THEN 'Utilities'
      WHEN 'conveyance' THEN 'Conveyance'
      WHEN 'loading' THEN 'Loading / labour'
      WHEN 'stationery' THEN 'Stationery'
      WHEN 'builty' THEN 'Builty expense'
      ELSE 'Other expense'
    END;

    v_narration := v_label || ' ' || v_no;
    IF v_sm_name IS NOT NULL THEN
      v_narration := v_narration || ' — ' || v_sm_name;
    END IF;
    IF v_wh_name IS NOT NULL THEN
      v_narration := v_narration || ' — ' || v_wh_name;
    END IF;
    IF v_vendor_name IS NOT NULL THEN
      v_narration := v_narration || ' — ' || v_vendor_name;
    END IF;
    IF v_remarks IS NOT NULL THEN
      v_narration := v_narration || ' — ' || v_remarks;
    END IF;

    PERFORM private.post_ledger(
      v_org_id, v_company_id, v_party, v_date,
      v_amount, 0, v_narration, 'expenses', v_id, 'EX'
    );

    v_ids := array_append(v_ids, v_id);
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Add at least one expense with amount';
  END IF;

  RETURN jsonb_build_object('ids', to_jsonb(v_ids), 'count', v_count);
END;
$$;

INSERT INTO public.parties (
  organization_id, company_id, party_code, name_en,
  party_type, party_subtype, head, sub_head
)
SELECT
  c.organization_id,
  c.id,
  'EXP-BUILTY',
  'Builty Expense',
  'EXPENSES',
  'other',
  'Expenses',
  'Builty Expense'
FROM public.companies c
ON CONFLICT (company_id, party_code) DO NOTHING;
