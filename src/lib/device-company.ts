/**
 * The account has one saved company (profiles.active_company_id). That value
 * is only a default for a computer that has not chosen yet. Each browser
 * stores its own choice in this cookie so switching or signing out on one
 * computer leaves the other computer where it is.
 */
export const DEVICE_COMPANY_COOKIE = "ud_company";

const COMPANY_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_AGE = 60 * 60 * 24 * 365;

export function pickWorkingCompanyId(
  deviceCompanyId: string | null | undefined,
  membershipCompanyIds: string[],
  profileCompanyId: string | null | undefined,
): string | null {
  const device =
    deviceCompanyId && COMPANY_ID.test(deviceCompanyId) ? deviceCompanyId : null;
  if (device && membershipCompanyIds.includes(device)) return device;
  if (profileCompanyId && membershipCompanyIds.includes(profileCompanyId)) {
    return profileCompanyId;
  }
  return null;
}

export function readDeviceCompanyCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${DEVICE_COMPANY_COOKIE}=([^;]*)`),
  );
  if (!match) return null;
  const value = decodeURIComponent(match[1] || "");
  return COMPANY_ID.test(value) ? value : null;
}

export function writeDeviceCompanyCookie(companyId: string) {
  if (typeof document === "undefined") return;
  if (!COMPANY_ID.test(companyId)) return;
  document.cookie = `${DEVICE_COMPANY_COOKIE}=${companyId}; path=/; SameSite=Lax; max-age=${MAX_AGE}`;
}
