/**
 * Compact offline shell snapshot stored in a cookie so Next.js server
 * components can render without contacting Supabase when offline.
 */

export const OFFLINE_OK_COOKIE = "umar-offline-ok";
export const OFFLINE_SHELL_COOKIE = "umar-offline-shell";

export type OfflineShellSnapshot = {
  userId: string;
  email: string;
  fullName: string;
  activeCompanyId: string | null;
  isSuperAdmin: boolean;
  company: {
    id: string;
    name: string;
    organization_id: string;
    city?: string | null;
  } | null;
  memberships: Array<{
    company_id: string;
    role: string;
    companies: {
      id: string;
      name: string;
      organization_id?: string;
      city?: string | null;
    } | null;
  }>;
  savedAt: string;
};

/** Encode JSON to URL-safe base64 (no Node "base64url" — Electron Node may lack it). */
function toBase64Url(json: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(json, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(raw: string): string {
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64 + "===".slice((b64.length + 3) % 4);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(pad, "base64").toString("utf8");
  }
  return decodeURIComponent(
    Array.from(atob(pad), (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(
      "",
    ),
  );
}

export function encodeOfflineShell(snapshot: OfflineShellSnapshot): string {
  return toBase64Url(JSON.stringify(snapshot));
}

export function decodeOfflineShell(raw: string | undefined | null): OfflineShellSnapshot | null {
  if (!raw) return null;
  try {
    const json = fromBase64Url(raw);
    const parsed = JSON.parse(json) as OfflineShellSnapshot;
    if (!parsed?.userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Client: persist shell cookie after login / company pick. */
export function writeOfflineShellCookie(snapshot: OfflineShellSnapshot) {
  if (typeof document === "undefined") return;
  const value = encodeOfflineShell(snapshot);
  // Keep under ~3500 chars to stay within cookie limits
  if (value.length > 3500) {
    const slim: OfflineShellSnapshot = {
      ...snapshot,
      memberships: snapshot.memberships.slice(0, 8).map((m) => ({
        company_id: m.company_id,
        role: m.role,
        companies: m.companies
          ? {
              id: m.companies.id,
              name: m.companies.name,
              organization_id: m.companies.organization_id,
            }
          : null,
      })),
    };
    document.cookie = `${OFFLINE_SHELL_COOKIE}=${encodeURIComponent(encodeOfflineShell(slim))}; path=/; SameSite=Lax; max-age=${60 * 60 * 24 * 30}`;
    return;
  }
  document.cookie = `${OFFLINE_SHELL_COOKIE}=${encodeURIComponent(value)}; path=/; SameSite=Lax; max-age=${60 * 60 * 24 * 30}`;
}

export function clearOfflineShellCookie() {
  if (typeof document === "undefined") return;
  document.cookie = `${OFFLINE_SHELL_COOKIE}=; path=/; Max-Age=0`;
}

/** Client: read shell cookie written during last online session / unlock. */
export function readOfflineShellCookie(): OfflineShellSnapshot | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${OFFLINE_SHELL_COOKIE}=`));
  if (!match) return null;
  const raw = match.slice(OFFLINE_SHELL_COOKIE.length + 1);
  return decodeOfflineShell(decodeURIComponent(raw));
}

/** Build a shell snapshot from in-memory session props (AppShell / SyncProvider). */
export function buildOfflineShellSnapshot(input: {
  userId: string;
  email?: string | null;
  fullName?: string | null;
  profile?: Record<string, unknown> | null;
  company?: Record<string, unknown> | null;
  memberships?: Record<string, unknown>[] | null;
}): OfflineShellSnapshot | null {
  const profile = input.profile || {};
  const userId =
    input.userId ||
    (typeof profile.id === "string" ? profile.id : "") ||
    "";
  if (!userId) return null;

  const companyRaw = input.company;
  const company =
    companyRaw && typeof companyRaw.id === "string"
      ? {
          id: String(companyRaw.id),
          name: String(companyRaw.name || "Company"),
          organization_id: String(companyRaw.organization_id || ""),
          city:
            companyRaw.city == null ? null : String(companyRaw.city),
        }
      : null;

  const memberships = (input.memberships || []).map((m) => {
    const companies = m.companies as Record<string, unknown> | null | undefined;
    return {
      company_id: String(m.company_id || ""),
      role: String(m.role || "staff"),
      companies:
        companies && typeof companies.id === "string"
          ? {
              id: String(companies.id),
              name: String(companies.name || "Company"),
              organization_id:
                companies.organization_id == null
                  ? undefined
                  : String(companies.organization_id),
              city:
                companies.city == null ? null : String(companies.city),
            }
          : null,
    };
  });

  return {
    userId,
    email: String(input.email || profile.email || ""),
    fullName: String(
      input.fullName || profile.full_name || input.email || "User",
    ),
    activeCompanyId:
      (typeof profile.active_company_id === "string"
        ? profile.active_company_id
        : null) ||
      company?.id ||
      null,
    isSuperAdmin: Boolean(profile.is_super_admin),
    company,
    memberships,
    savedAt: new Date().toISOString(),
  };
}
