-- Shared delete guard runs on products/parties/lines (no status) and headers (have status).
-- OLD.status in one AND-chain can still blow up on tables without that column.
-- Read status via jsonb only inside the cancelled-header branch.

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
  v_old_status text;
BEGIN
  IF auth.uid() IS NULL OR private.is_super_admin() THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'recoveries'
       AND current_setting('app.cancelling_recovery', true) = '1' THEN
      RETURN OLD;
    END IF;

    IF current_setting('app.replacing_document_lines', true) = '1' THEN
      IF TG_TABLE_NAME IN (
        'sale_invoice_items',
        'purchase_invoice_items',
        'sale_return_items',
        'purchase_return_items',
        'voucher_lines'
      ) THEN
        RETURN OLD;
      END IF;

      IF TG_TABLE_NAME IN (
        'sale_invoices',
        'purchase_invoices',
        'sale_returns',
        'purchase_returns',
        'vouchers'
      ) THEN
        v_old_status := to_jsonb(OLD)->>'status';
        IF v_old_status = 'cancelled' THEN
          RETURN OLD;
        END IF;
      END IF;
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
