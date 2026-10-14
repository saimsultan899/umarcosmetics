-- Sale invoice "Prepared By" comes from company settings for every tenant.
-- Umar Group companies keep the existing prepared-by text as a default seed.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS prepared_by text;

COMMENT ON COLUMN public.companies.prepared_by IS
  'Printed on sale invoices as Prepared By. Editable in Company settings.';

UPDATE public.companies c
SET prepared_by = 'USMAN ISHAQ (0308-8664002)'
FROM public.organizations o
WHERE c.organization_id = o.id
  AND lower(o.name) = 'umar group'
  AND (c.prepared_by IS NULL OR trim(c.prepared_by) = '');
