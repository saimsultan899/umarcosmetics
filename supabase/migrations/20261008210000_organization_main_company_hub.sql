-- Organization main-company hub.
-- When organizations.main_company_id is set, other companies under the same
-- organization mirror products + shops to the main company, and purchase stock
-- on a spoke also restocks the linked product on main.
-- Single-company orgs leave main_company_id null and are unchanged.
-- Invoices / ledgers stay per company.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS main_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS hub_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;

ALTER TABLE public.parties
  ADD COLUMN IF NOT EXISTS hub_party_id uuid REFERENCES public.parties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS products_hub_product_id_idx
  ON public.products (hub_product_id)
  WHERE hub_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS parties_hub_party_id_idx
  ON public.parties (hub_party_id)
  WHERE hub_party_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.hub_mirroring()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(nullif(current_setting('app.hub_mirroring', true), ''), '0') = '1';
$$;

CREATE OR REPLACE FUNCTION private.set_hub_mirroring(p_on boolean)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.hub_mirroring', CASE WHEN p_on THEN '1' ELSE '0' END, true);
END;
$$;

CREATE OR REPLACE FUNCTION private.org_main_company_id(p_company_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT o.main_company_id
  FROM public.companies c
  JOIN public.organizations o ON o.id = c.organization_id
  WHERE c.id = p_company_id;
$$;

CREATE OR REPLACE FUNCTION private.ensure_hub_warehouse(
  p_spoke_warehouse_id uuid,
  p_main_company_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_spoke public.warehouses%rowtype;
  v_hub uuid;
  v_org uuid;
BEGIN
  IF p_spoke_warehouse_id IS NULL OR p_main_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_spoke FROM public.warehouses WHERE id = p_spoke_warehouse_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT organization_id INTO v_org FROM public.companies WHERE id = p_main_company_id;

  SELECT id INTO v_hub
  FROM public.warehouses
  WHERE company_id = p_main_company_id
    AND lower(trim(name)) = lower(trim(v_spoke.name))
  LIMIT 1;

  IF v_hub IS NOT NULL THEN
    RETURN v_hub;
  END IF;

  INSERT INTO public.warehouses (
    organization_id, company_id, name, code, address, is_active
  ) VALUES (
    v_org, p_main_company_id, v_spoke.name, v_spoke.code, v_spoke.address, true
  )
  RETURNING id INTO v_hub;

  RETURN v_hub;
END;
$$;

CREATE OR REPLACE FUNCTION private.sync_product_master_fields(
  p_from_id uuid,
  p_to_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_from public.products%rowtype;
  v_to_company uuid;
  v_hub_wh uuid;
BEGIN
  IF p_from_id IS NULL OR p_to_id IS NULL OR p_from_id = p_to_id THEN
    RETURN;
  END IF;

  SELECT * INTO v_from FROM public.products WHERE id = p_from_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT company_id INTO v_to_company FROM public.products WHERE id = p_to_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_hub_wh := private.ensure_hub_warehouse(v_from.default_warehouse_id, v_to_company);

  UPDATE public.products SET
    name_en = v_from.name_en,
    name_ur = v_from.name_ur,
    product_type = v_from.product_type,
    manufacturer = v_from.manufacturer,
    category_group = v_from.category_group,
    barcode = CASE
      WHEN v_from.barcode IS NULL THEN barcode
      WHEN EXISTS (
        SELECT 1 FROM public.products x
        WHERE x.company_id = v_to_company
          AND x.id <> p_to_id
          AND x.barcode IS NOT NULL
          AND lower(trim(x.barcode)) = lower(trim(v_from.barcode))
      ) THEN barcode
      ELSE v_from.barcode
    END,
    extra_barcodes = coalesce(v_from.extra_barcodes, '[]'::jsonb),
    default_warehouse_id = coalesce(v_hub_wh, default_warehouse_id),
    retail_rate = v_from.retail_rate,
    purchase_rate = v_from.purchase_rate,
    wholesale_rate = v_from.wholesale_rate,
    sale_rate = v_from.sale_rate,
    print_rate = v_from.print_rate,
    opening_rate = v_from.opening_rate,
    reorder_level = v_from.reorder_level,
    packing = v_from.packing,
    unit_type = v_from.unit_type,
    base_unit = v_from.base_unit,
    scheme = v_from.scheme,
    is_active = v_from.is_active,
    updated_at = now()
  WHERE id = p_to_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.ensure_hub_product(p_product_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_src public.products%rowtype;
  v_main uuid;
  v_hub uuid;
  v_hub_wh uuid;
  v_org uuid;
BEGIN
  IF p_product_id IS NULL OR private.hub_mirroring() THEN
    RETURN p_product_id;
  END IF;

  SELECT * INTO v_src FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_main := private.org_main_company_id(v_src.company_id);
  IF v_main IS NULL THEN
    RETURN NULL;
  END IF;

  -- Product already on main.
  IF v_src.company_id = v_main THEN
    RETURN v_src.id;
  END IF;

  IF v_src.hub_product_id IS NOT NULL THEN
    RETURN v_src.hub_product_id;
  END IF;

  SELECT id INTO v_hub
  FROM public.products
  WHERE company_id = v_main
    AND lower(trim(code)) = lower(trim(v_src.code))
  LIMIT 1;

  IF v_hub IS NOT NULL THEN
    UPDATE public.products SET hub_product_id = v_hub WHERE id = v_src.id;
    PERFORM private.set_hub_mirroring(true);
    PERFORM private.sync_product_master_fields(v_src.id, v_hub);
    PERFORM private.set_hub_mirroring(false);
    RETURN v_hub;
  END IF;

  SELECT organization_id INTO v_org FROM public.companies WHERE id = v_main;
  v_hub_wh := private.ensure_hub_warehouse(v_src.default_warehouse_id, v_main);

  PERFORM private.set_hub_mirroring(true);
  INSERT INTO public.products (
    organization_id, company_id, code, name_en, name_ur,
    product_type, manufacturer, category_group, barcode, extra_barcodes,
    default_warehouse_id,
    retail_rate, purchase_rate, wholesale_rate, sale_rate, print_rate,
    opening_rate, opening_qty, reorder_level, packing, unit_type, base_unit, scheme,
    is_active, created_by
  ) VALUES (
    v_org, v_main, v_src.code, v_src.name_en, v_src.name_ur,
    v_src.product_type, v_src.manufacturer, v_src.category_group,
    CASE
      WHEN v_src.barcode IS NULL THEN NULL
      WHEN EXISTS (
        SELECT 1 FROM public.products x
        WHERE x.company_id = v_main
          AND x.barcode IS NOT NULL
          AND lower(trim(x.barcode)) = lower(trim(v_src.barcode))
      ) THEN NULL
      ELSE v_src.barcode
    END,
    coalesce(v_src.extra_barcodes, '[]'::jsonb),
    v_hub_wh,
    v_src.retail_rate, v_src.purchase_rate, v_src.wholesale_rate, v_src.sale_rate, v_src.print_rate,
    v_src.opening_rate, 0, v_src.reorder_level, v_src.packing, v_src.unit_type, v_src.base_unit, v_src.scheme,
    v_src.is_active, auth.uid()
  )
  RETURNING id INTO v_hub;
  PERFORM private.set_hub_mirroring(false);

  UPDATE public.products SET hub_product_id = v_hub WHERE id = v_src.id;
  RETURN v_hub;
END;
$$;

CREATE OR REPLACE FUNCTION private.mirror_product_to_hub(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_src public.products%rowtype;
  v_main uuid;
  v_hub uuid;
  r record;
BEGIN
  IF p_product_id IS NULL OR private.hub_mirroring() THEN
    RETURN;
  END IF;

  SELECT * INTO v_src FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_main := private.org_main_company_id(v_src.company_id);
  IF v_main IS NULL THEN RETURN; END IF;

  IF v_src.company_id = v_main THEN
    -- Main product changed: push master fields to linked spoke products.
    PERFORM private.set_hub_mirroring(true);
    FOR r IN
      SELECT id FROM public.products
      WHERE hub_product_id = v_src.id
        AND company_id <> v_main
    LOOP
      PERFORM private.sync_product_master_fields(v_src.id, r.id);
    END LOOP;
    PERFORM private.set_hub_mirroring(false);
    RETURN;
  END IF;

  v_hub := private.ensure_hub_product(v_src.id);
  IF v_hub IS NULL THEN RETURN; END IF;

  PERFORM private.set_hub_mirroring(true);
  PERFORM private.sync_product_master_fields(v_src.id, v_hub);
  PERFORM private.set_hub_mirroring(false);
END;
$$;

CREATE OR REPLACE FUNCTION private.ensure_hub_party(p_party_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_src public.parties%rowtype;
  v_main uuid;
  v_hub uuid;
  v_org uuid;
BEGIN
  IF p_party_id IS NULL OR private.hub_mirroring() THEN
    RETURN p_party_id;
  END IF;

  SELECT * INTO v_src FROM public.parties WHERE id = p_party_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_main := private.org_main_company_id(v_src.company_id);
  IF v_main IS NULL THEN RETURN NULL; END IF;
  IF v_src.company_id = v_main THEN RETURN v_src.id; END IF;
  IF v_src.hub_party_id IS NOT NULL THEN RETURN v_src.hub_party_id; END IF;

  SELECT id INTO v_hub
  FROM public.parties
  WHERE company_id = v_main
    AND lower(trim(party_code)) = lower(trim(v_src.party_code))
  LIMIT 1;

  IF v_hub IS NOT NULL THEN
    UPDATE public.parties SET hub_party_id = v_hub WHERE id = v_src.id;
    RETURN v_hub;
  END IF;

  SELECT organization_id INTO v_org FROM public.companies WHERE id = v_main;

  PERFORM private.set_hub_mirroring(true);
  INSERT INTO public.parties (
    organization_id, company_id, party_code, name_en, name_ur,
    party_type, party_subtype, address, sub_head, city, head, route,
    phone, mobile, contact_person, ntn, opening_balance, credit_limit,
    sale_channel, is_active
  ) VALUES (
    v_org, v_main, v_src.party_code, v_src.name_en, v_src.name_ur,
    v_src.party_type, v_src.party_subtype, v_src.address, v_src.sub_head, v_src.city, v_src.head, v_src.route,
    v_src.phone, v_src.mobile, v_src.contact_person, v_src.ntn,
    0, v_src.credit_limit, v_src.sale_channel, v_src.is_active
  )
  RETURNING id INTO v_hub;
  PERFORM private.set_hub_mirroring(false);

  UPDATE public.parties SET hub_party_id = v_hub WHERE id = v_src.id;
  RETURN v_hub;
END;
$$;

CREATE OR REPLACE FUNCTION private.sync_party_master_fields(p_from_id uuid, p_to_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_from public.parties%rowtype;
BEGIN
  IF p_from_id IS NULL OR p_to_id IS NULL OR p_from_id = p_to_id THEN RETURN; END IF;
  SELECT * INTO v_from FROM public.parties WHERE id = p_from_id;
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE public.parties SET
    name_en = v_from.name_en,
    name_ur = v_from.name_ur,
    party_type = v_from.party_type,
    party_subtype = v_from.party_subtype,
    address = v_from.address,
    sub_head = v_from.sub_head,
    city = v_from.city,
    head = v_from.head,
    route = v_from.route,
    phone = v_from.phone,
    mobile = v_from.mobile,
    contact_person = v_from.contact_person,
    ntn = v_from.ntn,
    credit_limit = v_from.credit_limit,
    sale_channel = v_from.sale_channel,
    is_active = v_from.is_active,
    updated_at = now()
  WHERE id = p_to_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.mirror_party_to_hub(p_party_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_src public.parties%rowtype;
  v_main uuid;
  v_hub uuid;
  r record;
BEGIN
  IF p_party_id IS NULL OR private.hub_mirroring() THEN RETURN; END IF;

  SELECT * INTO v_src FROM public.parties WHERE id = p_party_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_main := private.org_main_company_id(v_src.company_id);
  IF v_main IS NULL THEN RETURN; END IF;

  IF v_src.company_id = v_main THEN
    PERFORM private.set_hub_mirroring(true);
    FOR r IN
      SELECT id FROM public.parties
      WHERE hub_party_id = v_src.id AND company_id <> v_main
    LOOP
      PERFORM private.sync_party_master_fields(v_src.id, r.id);
    END LOOP;
    PERFORM private.set_hub_mirroring(false);
    RETURN;
  END IF;

  v_hub := private.ensure_hub_party(v_src.id);
  IF v_hub IS NULL THEN RETURN; END IF;

  PERFORM private.set_hub_mirroring(true);
  PERFORM private.sync_party_master_fields(v_src.id, v_hub);
  PERFORM private.set_hub_mirroring(false);
END;
$$;

CREATE OR REPLACE FUNCTION private.apply_hub_purchase_stock(
  p_spoke_company_id uuid,
  p_spoke_warehouse_id uuid,
  p_spoke_product_id uuid,
  p_qty numeric,
  p_ref_table text,
  p_ref_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_main uuid;
  v_hub_product uuid;
  v_hub_wh uuid;
BEGIN
  IF coalesce(p_qty, 0) = 0 THEN RETURN; END IF;

  v_main := private.org_main_company_id(p_spoke_company_id);
  IF v_main IS NULL OR v_main = p_spoke_company_id THEN
    RETURN;
  END IF;

  v_hub_product := private.ensure_hub_product(p_spoke_product_id);
  IF v_hub_product IS NULL THEN RETURN; END IF;

  v_hub_wh := private.ensure_hub_warehouse(p_spoke_warehouse_id, v_main);
  IF v_hub_wh IS NULL THEN RETURN; END IF;

  PERFORM private.apply_stock_delta(
    v_main,
    v_hub_wh,
    v_hub_product,
    p_qty,
    'purchase',
    p_ref_table,
    p_ref_id,
    true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_mirror_product_to_hub()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM private.mirror_product_to_hub(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_mirror_hub ON public.products;
CREATE TRIGGER products_mirror_hub
  AFTER INSERT OR UPDATE OF
    name_en, name_ur, product_type, manufacturer, category_group,
    barcode, extra_barcodes, default_warehouse_id,
    retail_rate, purchase_rate, wholesale_rate, sale_rate, print_rate,
    opening_rate, reorder_level, packing, unit_type, base_unit, scheme, is_active
  ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_mirror_product_to_hub();

CREATE OR REPLACE FUNCTION public.trg_mirror_party_to_hub()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Expense ledger parties stay local.
  IF NEW.party_type = 'EXPENSES' THEN
    RETURN NEW;
  END IF;
  PERFORM private.mirror_party_to_hub(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS parties_mirror_hub ON public.parties;
CREATE TRIGGER parties_mirror_hub
  AFTER INSERT OR UPDATE OF
    name_en, name_ur, party_type, party_subtype, address, sub_head, city, head, route,
    phone, mobile, contact_person, ntn, credit_limit, sale_channel, is_active, party_code
  ON public.parties
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_mirror_party_to_hub();

CREATE OR REPLACE FUNCTION public.set_organization_main_company(
  p_organization_id uuid,
  p_main_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT private.is_super_admin()
     AND NOT EXISTS (
       SELECT 1 FROM public.company_members cm
       JOIN public.companies c ON c.id = cm.company_id
       WHERE cm.user_id = auth.uid()
         AND cm.is_active
         AND cm.role = 'org_admin'
         AND c.organization_id = p_organization_id
     ) THEN
    RAISE EXCEPTION 'Only the organization admin can set the main company';
  END IF;

  IF p_main_company_id IS NOT NULL THEN
    SELECT name INTO v_name
    FROM public.companies
    WHERE id = p_main_company_id
      AND organization_id = p_organization_id
      AND is_active;
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'Main company must belong to this organization';
    END IF;
  END IF;

  UPDATE public.organizations
  SET main_company_id = p_main_company_id,
      updated_at = now()
  WHERE id = p_organization_id;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'main_company_id', p_main_company_id,
    'main_company_name', v_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_organization_hub_catalog(p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_main uuid;
  v_main_name text;
  r record;
  v_products int := 0;
  v_parties int := 0;
  v_warehouses int := 0;
  v_wh record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT main_company_id INTO v_main
  FROM public.organizations WHERE id = p_organization_id;
  IF v_main IS NULL THEN
    RAISE EXCEPTION 'Set a main company first';
  END IF;

  IF NOT private.is_super_admin()
     AND NOT private.can_write_company(v_main) THEN
    RAISE EXCEPTION 'No write access to the main company';
  END IF;

  SELECT name INTO v_main_name FROM public.companies WHERE id = v_main;

  -- Ensure brand companies (warehouses) exist on main for every spoke warehouse.
  FOR v_wh IN
    SELECT w.*
    FROM public.warehouses w
    JOIN public.companies c ON c.id = w.company_id
    WHERE c.organization_id = p_organization_id
      AND c.id <> v_main
      AND w.is_active
  LOOP
    IF private.ensure_hub_warehouse(v_wh.id, v_main) IS NOT NULL THEN
      v_warehouses := v_warehouses + 1;
    END IF;
  END LOOP;

  FOR r IN
    SELECT p.id
    FROM public.products p
    JOIN public.companies c ON c.id = p.company_id
    WHERE c.organization_id = p_organization_id
      AND c.id <> v_main
      AND p.is_active
  LOOP
    IF private.ensure_hub_product(r.id) IS NOT NULL THEN
      v_products := v_products + 1;
      PERFORM private.mirror_product_to_hub(r.id);
    END IF;
  END LOOP;

  FOR r IN
    SELECT p.id
    FROM public.parties p
    JOIN public.companies c ON c.id = p.company_id
    WHERE c.organization_id = p_organization_id
      AND c.id <> v_main
      AND p.is_active
      AND p.party_type <> 'EXPENSES'
  LOOP
    IF private.ensure_hub_party(r.id) IS NOT NULL THEN
      v_parties := v_parties + 1;
      PERFORM private.mirror_party_to_hub(r.id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'main_company_id', v_main,
    'main_company_name', v_main_name,
    'products_synced', v_products,
    'parties_synced', v_parties,
    'warehouses_touched', v_warehouses
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_organization_main_company(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_organization_hub_catalog(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_organization_main_company(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_organization_hub_catalog(uuid) TO authenticated, service_role;
