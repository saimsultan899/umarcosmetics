-- Brand company (warehouse): setup opening payable + pay purchase invoices by allocation.

ALTER TABLE public.warehouses
  ADD COLUMN IF NOT EXISTS opening_payable numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.warehouses.opening_payable IS
  'Amount owed to the linked vendor before system go-live (company statement opening).';

CREATE TABLE IF NOT EXISTS public.warehouse_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  voucher_id uuid NOT NULL REFERENCES public.vouchers(id) ON DELETE CASCADE,
  purchase_invoice_id uuid NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_payment_allocations_unique
    UNIQUE (voucher_id, purchase_invoice_id)
);

CREATE INDEX IF NOT EXISTS warehouse_payment_allocations_pi_idx
  ON public.warehouse_payment_allocations (purchase_invoice_id);

CREATE INDEX IF NOT EXISTS warehouse_payment_allocations_wh_idx
  ON public.warehouse_payment_allocations (company_id, warehouse_id);

ALTER TABLE public.warehouse_payment_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY warehouse_payment_allocations_select ON public.warehouse_payment_allocations
  FOR SELECT TO authenticated
  USING (private.can_write_company(company_id));

CREATE POLICY warehouse_payment_allocations_insert ON public.warehouse_payment_allocations
  FOR INSERT TO authenticated
  WITH CHECK (private.can_write_company(company_id));

CREATE OR REPLACE FUNCTION private.purchase_invoice_paid_amount(p_purchase_invoice_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(sum(a.amount), 0)
  FROM public.warehouse_payment_allocations a
  JOIN public.vouchers v ON v.id = a.voucher_id
  WHERE a.purchase_invoice_id = p_purchase_invoice_id
    AND v.status = 'posted';
$$;

CREATE OR REPLACE FUNCTION private.insert_payment_allocations(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_voucher_id uuid,
  p_allocations jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item jsonb;
  v_pi_id uuid;
  v_amount numeric;
  v_pi_total numeric;
  v_pi_wh uuid;
  v_paid numeric;
  v_alloc_total numeric := 0;
BEGIN
  IF p_allocations IS NULL OR jsonb_array_length(p_allocations) = 0 THEN
    RETURN;
  END IF;

  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Select a company warehouse to allocate payment to purchase bills';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_allocations)
  LOOP
    v_pi_id := nullif(v_item->>'purchase_invoice_id', '')::uuid;
    v_amount := coalesce((v_item->>'amount')::numeric, 0);
    IF v_pi_id IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'Each allocation needs a purchase bill and a positive amount';
    END IF;

    SELECT pi.grand_total, pi.warehouse_id
      INTO v_pi_total, v_pi_wh
    FROM public.purchase_invoices pi
    WHERE pi.id = v_pi_id
      AND pi.company_id = p_company_id
      AND pi.status = 'posted';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Purchase bill not found or not posted';
    END IF;

    IF v_pi_wh IS DISTINCT FROM p_warehouse_id THEN
      RAISE EXCEPTION 'Purchase bill does not belong to this company';
    END IF;

    v_paid := private.purchase_invoice_paid_amount(v_pi_id);
    IF v_amount > v_pi_total - v_paid + 0.005 THEN
      RAISE EXCEPTION 'Payment allocation is more than the remaining balance on purchase bill %', v_pi_id;
    END IF;

    v_alloc_total := v_alloc_total + v_amount;

    INSERT INTO public.warehouse_payment_allocations (
      company_id, warehouse_id, voucher_id, purchase_invoice_id, amount
    ) VALUES (
      p_company_id, p_warehouse_id, p_voucher_id, v_pi_id, v_amount
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_cash_payment(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_id uuid;
  v_no text;
  v_line jsonb;
  v_idx int := 0;
  v_total numeric := 0;
  v_alloc_total numeric := 0;
  v_item jsonb;
  v_date date := coalesce((p_payload->>'voucher_date')::date, current_date);
  v_method text := lower(trim(coalesce(p_payload->>'payment_method', 'cash')));
  v_warehouse uuid := nullif(p_payload->>'warehouse_id', '')::uuid;
  v_sender_bank text := nullif(trim(coalesce(p_payload->>'sender_bank_name', '')), '');
  v_sender_name text := nullif(trim(coalesce(p_payload->>'sender_account_name', '')), '');
  v_sender_no text := nullif(trim(coalesce(p_payload->>'sender_account_no', '')), '');
  v_receiver_bank text := nullif(trim(coalesce(p_payload->>'receiver_bank_name', '')), '');
  v_receiver_name text := nullif(trim(coalesce(p_payload->>'receiver_account_name', '')), '');
  v_receiver_no text := nullif(trim(coalesce(p_payload->>'receiver_account_no', '')), '');
BEGIN
  IF NOT private.can_write_company(v_company_id) THEN
    RAISE EXCEPTION 'No write access';
  END IF;

  IF v_method NOT IN ('cash', 'bank_transfer', 'other') THEN
    RAISE EXCEPTION 'Payment method must be cash, bank transfer, or other';
  END IF;

  IF v_method = 'bank_transfer' THEN
    IF v_sender_bank IS NULL OR v_receiver_bank IS NULL THEN
      RAISE EXCEPTION 'Select the sender bank and the receiver bank';
    END IF;
    IF v_sender_name IS NULL OR v_receiver_name IS NULL THEN
      RAISE EXCEPTION 'Enter the sender name and the receiver name';
    END IF;
    IF v_sender_no IS NULL OR v_receiver_no IS NULL THEN
      RAISE EXCEPTION 'Enter the sender account number and the receiver account number';
    END IF;
  ELSE
    v_sender_bank := NULL;
    v_sender_name := NULL;
    v_sender_no := NULL;
    v_receiver_bank := NULL;
    v_receiver_name := NULL;
    v_receiver_no := NULL;
  END IF;

  IF v_warehouse IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.warehouses
      WHERE id = v_warehouse AND company_id = v_company_id
    ) THEN
      RAISE EXCEPTION 'Unknown company warehouse';
    END IF;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  LOOP
    v_total := v_total + coalesce((v_line->>'amount')::numeric, 0);
  END LOOP;
  IF v_total <= 0 THEN
    v_total := coalesce(nullif(p_payload->>'amount','')::numeric, 0);
  END IF;
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Payment total must be greater than zero';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'purchase_allocations', '[]'::jsonb))
  LOOP
    v_alloc_total := v_alloc_total + coalesce((v_item->>'amount')::numeric, 0);
  END LOOP;
  IF v_alloc_total > v_total + 0.005 THEN
    RAISE EXCEPTION 'Allocated amounts cannot exceed the payment total';
  END IF;

  v_no := public.next_document_no(v_company_id, 'cash_payment', NULL);
  INSERT INTO public.vouchers (
    organization_id, company_id, voucher_type, voucher_no, voucher_date,
    total_amount, narration, status, created_by, payment_method, warehouse_id,
    bank_name, bank_account_name, bank_account_no,
    sender_bank_name, sender_account_name, sender_account_no,
    receiver_bank_name, receiver_account_name, receiver_account_no
  ) VALUES (
    v_org_id, v_company_id, 'CP', v_no, v_date, v_total,
    nullif(p_payload->>'narration',''), 'posted', auth.uid(),
    v_method, v_warehouse,
    v_receiver_bank, v_receiver_name, v_receiver_no,
    v_sender_bank, v_sender_name, v_sender_no,
    v_receiver_bank, v_receiver_name, v_receiver_no
  ) RETURNING id INTO v_id;

  PERFORM private.insert_payment_allocations(
    v_company_id, v_warehouse, v_id, p_payload->'purchase_allocations'
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  LOOP
    IF nullif(v_line->>'party_id','') IS NOT NULL THEN
      INSERT INTO public.voucher_lines (voucher_id, company_id, party_id, amount, narration, sort_order)
      VALUES (
        v_id, v_company_id, (v_line->>'party_id')::uuid, (v_line->>'amount')::numeric,
        nullif(v_line->>'narration',''), v_idx
      );
      PERFORM private.post_ledger(
        v_org_id, v_company_id, (v_line->>'party_id')::uuid, v_date,
        (v_line->>'amount')::numeric, 0,
        coalesce(nullif(v_line->>'narration',''), 'Cash payment ' || v_no),
        'vouchers', v_id, 'CP'
      );
    END IF;
    v_idx := v_idx + 1;
  END LOOP;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_cash_payment(jsonb) TO authenticated, service_role;
