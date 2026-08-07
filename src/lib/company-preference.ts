const KEY = "umar.lastCompanyId";

export function getPreferredCompanyId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setPreferredCompanyId(companyId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, companyId);
  } catch {
    // ignore
  }
}
