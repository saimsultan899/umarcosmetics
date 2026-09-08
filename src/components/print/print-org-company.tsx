export function PrintOrgCompany({
  companyName,
  brandName,
}: {
  /** Distributor workspace, e.g. Umar Cosmetic */
  companyName?: string | null;
  /** Brand / warehouse from the Company filter, e.g. AURA */
  brandName?: string | null;
}) {
  if (!companyName && !brandName) return null;
  return (
    <div className="print-brand-head">
      {companyName ? (
        <p className="print-distributor-name">{companyName}</p>
      ) : null}
      {brandName ? (
        <p className="print-company-line">
          Company: <strong>{brandName}</strong>
        </p>
      ) : null}
    </div>
  );
}
