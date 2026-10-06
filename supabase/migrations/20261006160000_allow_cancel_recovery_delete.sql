-- cancel_recovery deletes the recovery row after reversing the ledger.
-- The delete guard treated that like deleting a posted voucher and blocked it.

CREATE OR REPLACE FUNCTION private.guard_record_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_key text;
  v_company_id uuid;
  v_status_changed boolean;
  v_fields_changed boolean;
BEGIN
  IF auth.uid() IS NULL OR private.is_super_admin() THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Set only inside cancel_recovery, for this transaction.
    IF TG_TABLE_NAME = 'recoveries'
       AND current_setting('app.cancelling_recovery', true) = '1' THEN
      RETURN OLD;
    END IF;

    v_company_id := OLD.company_id;
    IF TG_TABLE_NAME IN ('products', 'parties') THEN
      IF EXISTS (
        SELECT 1
        FROM public.company_members cm
        WHERE cm.user_id = auth.uid()
          AND cm.company_id = v_company_id
          AND cm.is_active
          AND cm.role = 'org_admin'
      ) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'Only the organization admin can delete products and customers.'
        USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'Posted sales, purchases, vouchers, and returns cannot be deleted. Correct them with a return or a reversal.'
      USING ERRCODE = '42501';
  END IF;

  v_company_id := NEW.company_id;

  IF TG_OP = 'INSERT' THEN
    v_key := CASE TG_TABLE_NAME
      WHEN 'products' THEN 'edit_products'
      WHEN 'parties' THEN 'edit_customers'
      WHEN 'sale_invoices' THEN 'create_invoices'
      WHEN 'sale_returns' THEN 'create_invoices'
      WHEN 'purchase_invoices' THEN 'create_purchases'
      WHEN 'purchase_returns' THEN 'create_purchases'
      WHEN 'vouchers' THEN 'create_vouchers'
      ELSE NULL
    END;
    IF v_key IS NOT NULL AND NOT private.has_permission(v_company_id, v_key) THEN
      RAISE EXCEPTION 'You do not have permission for this action.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME IN ('products', 'parties') AND TG_OP = 'UPDATE' THEN
    v_status_changed := OLD.is_active IS DISTINCT FROM NEW.is_active;
    v_fields_changed := (to_jsonb(NEW) - 'is_active' - 'updated_at')
      IS DISTINCT FROM (to_jsonb(OLD) - 'is_active' - 'updated_at');
    IF v_status_changed
       AND NOT private.has_permission(v_company_id, 'inactivate_records') THEN
      RAISE EXCEPTION 'You do not have permission to inactivate records.'
        USING ERRCODE = '42501';
    END IF;
    IF v_fields_changed AND NOT private.has_permission(
      v_company_id,
      CASE
        WHEN TG_TABLE_NAME = 'products' THEN 'edit_products'
        ELSE 'edit_customers'
      END
    ) THEN
      RAISE EXCEPTION 'You do not have permission to edit this record.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_recovery(p_recovery_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_rec public.recoveries%rowtype;
  v_voucher public.vouchers%rowtype;
BEGIN
  SELECT * INTO v_rec FROM public.recoveries WHERE id = p_recovery_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recovery not found';
  END IF;

  IF NOT private.can_write_company(v_rec.company_id) THEN
    RAISE EXCEPTION 'No write access';
  END IF;

  IF coalesce(v_rec.amount, 0) <= 0 THEN
    RAISE EXCEPTION 'This recovery has no amount to cancel';
  END IF;

  IF v_rec.voucher_id IS NOT NULL THEN
    SELECT * INTO v_voucher FROM public.vouchers WHERE id = v_rec.voucher_id;
    IF FOUND THEN
      IF v_voucher.status = 'cancelled' THEN
        RAISE EXCEPTION 'This recovery is already cancelled';
      END IF;

      PERFORM private.post_ledger(
        v_rec.organization_id,
        v_rec.company_id,
        v_rec.party_id,
        v_rec.recovery_date,
        v_rec.amount,
        0,
        'Cancel recovery ' || coalesce(v_voucher.voucher_no, 'CR'),
        'vouchers',
        v_voucher.id,
        'CR'
      );

      UPDATE public.vouchers
      SET status = 'cancelled', updated_at = now()
      WHERE id = v_voucher.id;
    END IF;
  ELSE
    PERFORM private.post_ledger(
      v_rec.organization_id,
      v_rec.company_id,
      v_rec.party_id,
      v_rec.recovery_date,
      v_rec.amount,
      0,
      'Cancel recovery',
      'recoveries',
      v_rec.id,
      'CR'
    );
  END IF;

  PERFORM set_config('app.cancelling_recovery', '1', true);
  DELETE FROM public.recoveries WHERE id = v_rec.id;
END;
$$;
