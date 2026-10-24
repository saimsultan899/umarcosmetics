-- Shop codes are shared across an organization. The next code is one higher
-- than the highest code in any company in that organization.
-- A new shop whose number already belongs to an older main-company shop
-- stays its own shop and does not replace that shop's name, sector, or phone.

CREATE OR REPLACE FUNCTION private.org_party_code_floor(p_company_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT GREATEST(
    COALESCE((
      SELECT MAX(p.party_code::bigint)
      FROM public.parties p
      JOIN public.companies c ON c.id = p.company_id
      JOIN public.companies src ON src.id = p_company_id
      WHERE c.organization_id = src.organization_id
        AND p.party_code ~ '^[0-9]+$'
    ), 0),
    COALESCE((
      SELECT MAX(ds.next_number) - 1
      FROM public.document_series ds
      JOIN public.companies c ON c.id = ds.company_id
      JOIN public.companies src ON src.id = p_company_id
      WHERE c.organization_id = src.organization_id
        AND ds.series_type = 'party'
    ), 0)
  );
$$;

CREATE OR REPLACE FUNCTION public.peek_next_party_code(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT private.has_company_access(p_company_id) THEN
    RAISE EXCEPTION 'No access';
  END IF;

  RETURN (private.org_party_code_floor(p_company_id) + 1)::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_party_code(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid;
  v_next bigint;
BEGIN
  IF NOT private.can_write_company(p_company_id) AND NOT private.is_super_admin() THEN
    RAISE EXCEPTION 'No write access';
  END IF;

  SELECT organization_id INTO v_org
  FROM public.companies
  WHERE id = p_company_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('party-code:' || v_org::text));

  v_next := private.org_party_code_floor(p_company_id) + 1;

  INSERT INTO public.document_series (company_id, series_type, prefix, next_number, padding)
  SELECT c.id, 'party', '', v_next + 1, 0
  FROM public.companies c
  WHERE c.organization_id = v_org
  ON CONFLICT (company_id, series_type) DO UPDATE
    SET next_number = GREATEST(public.document_series.next_number, EXCLUDED.next_number);

  RETURN v_next::text;
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

  -- This number already belongs to an older shop. Do not link it and do not
  -- let the caller replace that shop's name, sector, or phone.
  IF v_hub IS NOT NULL THEN
    RETURN NULL;
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
