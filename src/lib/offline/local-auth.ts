/**
 * Local / desktop auth helpers: PIN vault, offline session cookie, cached tokens.
 */

import {
  cacheSession,
  getCachedSession,
} from "@/lib/offline/local-db";
import { isElectronRuntime } from "@/lib/offline/service-worker";

export type VaultMeta = {
  v?: number;
  emailHint?: string;
  companyId?: string | null;
  updatedAt?: string;
};

export type UnlockedCredentials = {
  email: string;
  password: string;
  companyId?: string | null;
  userId?: string | null;
};

type DesktopApi = {
  isDesktop: true;
  vaultExists: () => Promise<boolean>;
  vaultMeta: () => Promise<VaultMeta | null>;
  vaultSave: (payload: {
    pin: string;
    email: string;
    password: string;
    companyId?: string | null;
    userId?: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
  vaultUnlock: (
    pin: string,
  ) => Promise<{ ok: boolean; error?: string } & Partial<UnlockedCredentials>>;
  vaultClear: () => Promise<{ ok: boolean }>;
  isOnline: () => Promise<boolean>;
  printPreview?: () => Promise<{ ok?: boolean; error?: string | null }>;
  print?: () => Promise<{ ok?: boolean; error?: string | null }>;
  dbStatus?: () => Promise<{ ok: boolean; error?: string; path?: string }>;
  dbUpsertMaster?: (
    table: string,
    row: Record<string, unknown>,
  ) => Promise<{ ok: boolean; error?: string; id?: string }>;
  dbListMaster?: (
    table: string,
    companyId: string,
    limit?: number,
  ) => Promise<{ ok: boolean; error?: string; rows?: Record<string, unknown>[] }>;
  dbSaveSaleInvoice?: (
    input: Record<string, unknown>,
  ) => Promise<{ ok: boolean; error?: string; id?: string }>;
  dbSavePurchaseInvoice?: (
    input: Record<string, unknown>,
  ) => Promise<{ ok: boolean; error?: string; id?: string }>;
  dbListDocuments?: (
    table: string,
    companyId: string,
    limit?: number,
  ) => Promise<{ ok: boolean; error?: string; rows?: Record<string, unknown>[] }>;
  dbGetDocument?: (
    table: string,
    id: string,
  ) => Promise<{ ok: boolean; error?: string; row?: Record<string, unknown> | null }>;
  dbListOutbox?: (
    companyId: string,
    status?: string,
    limit?: number,
  ) => Promise<{ ok: boolean; error?: string; rows?: Record<string, unknown>[] }>;
  dbMarkOutbox?: (
    id: string,
    patch: Record<string, unknown>,
  ) => Promise<{ ok: boolean; error?: string; id?: string }>;
  dbMigrateLegacyDocNos?: (
    companyId: string,
  ) => Promise<{ ok: boolean; error?: string; count?: number }>;
  appVersion?: () => Promise<string>;
  checkForUpdates?: () => Promise<{ ok: boolean; error?: string }>;
  applyUpdate?: () => Promise<{ ok: boolean; error?: string }>;
  updaterState?: () => Promise<{
    configured?: boolean;
    downloaded?: boolean;
    version?: string | null;
    pendingUnsynced?: number;
  }>;
  onUpdaterEvent?: (
    cb: (payload: {
      status: string;
      version?: string;
      percent?: number;
      pendingUnsynced?: number;
      message?: string;
    }) => void,
  ) => () => void;
};

declare global {
  interface Window {
    umarDesktop?: DesktopApi;
  }
}

const OFFLINE_COOKIE = "umar-offline-ok";
const BROWSER_VAULT_KEY = "umar-browser-vault-v1";

export function hasDesktopVaultApi() {
  return typeof window !== "undefined" && !!window.umarDesktop?.isDesktop;
}

export async function isAppOnline(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return false;
  }
  if (hasDesktopVaultApi()) {
    try {
      return await window.umarDesktop!.isOnline();
    } catch {
      /* fall through */
    }
  }
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function setOfflineSessionCookie(enabled: boolean) {
  if (typeof document === "undefined") return;
  if (enabled) {
    document.cookie = `${OFFLINE_COOKIE}=1; path=/; SameSite=Lax; max-age=${60 * 60 * 24 * 30}`;
  } else {
    document.cookie = `${OFFLINE_COOKIE}=; path=/; Max-Age=0`;
  }
}

export function hasOfflineSessionCookie() {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((c) => c.trim().startsWith(`${OFFLINE_COOKIE}=1`));
}

/** Persist auth tokens for offline restore (IndexedDB). */
export async function cacheAuthTokens(session: {
  access_token: string;
  refresh_token: string;
  expires_at?: number | null;
  user?: { id?: string; email?: string | null } | null;
}) {
  await cacheSession("auth_tokens", {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? null,
    user_id: session.user?.id ?? null,
    email: session.user?.email ?? null,
    cachedAt: new Date().toISOString(),
  });
}

export async function getCachedAuthTokens(): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at?: number | null;
  user_id?: string | null;
  email?: string | null;
} | null> {
  const row = await getCachedSession("auth_tokens");
  if (!row || typeof row !== "object") return null;
  const t = row as Record<string, unknown>;
  if (typeof t.access_token !== "string" || typeof t.refresh_token !== "string") {
    return null;
  }
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: typeof t.expires_at === "number" ? t.expires_at : null,
    user_id: typeof t.user_id === "string" ? t.user_id : null,
    email: typeof t.email === "string" ? t.email : null,
  };
}

// ── Browser fallback vault (Web Crypto) when not in Electron ─────────

async function deriveBrowserKey(pin: string, salt: Uint8Array) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const saltBuf = salt.buffer.slice(
    salt.byteOffset,
    salt.byteOffset + salt.byteLength,
  ) as ArrayBuffer;
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBuf, iterations: 120_000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function saveBrowserVault(payload: {
  pin: string;
  email: string;
  password: string;
  companyId?: string | null;
  userId?: string | null;
}) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBrowserKey(payload.pin, salt);
  const plain = new TextEncoder().encode(
    JSON.stringify({
      email: payload.email,
      password: payload.password,
      companyId: payload.companyId || null,
      userId: payload.userId || null,
    }),
  );
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  const packed = {
    salt: Array.from(salt),
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(cipher)),
    emailHint: payload.email.replace(/(^.).*(@.*$)/, "$1***$2"),
    companyId: payload.companyId || null,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(BROWSER_VAULT_KEY, JSON.stringify(packed));
  return { ok: true as const };
}

async function unlockBrowserVault(pin: string) {
  const raw = localStorage.getItem(BROWSER_VAULT_KEY);
  if (!raw) return { ok: false as const, error: "No saved credentials" };
  try {
    const packed = JSON.parse(raw) as {
      salt: number[];
      iv: number[];
      data: number[];
    };
    const key = await deriveBrowserKey(pin, new Uint8Array(packed.salt));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(packed.iv).buffer as ArrayBuffer },
      key,
      new Uint8Array(packed.data),
    );
    const data = JSON.parse(new TextDecoder().decode(plain)) as UnlockedCredentials;
    return { ok: true as const, ...data };
  } catch {
    return { ok: false as const, error: "Incorrect PIN" };
  }
}

export async function vaultExists(): Promise<boolean> {
  if (hasDesktopVaultApi()) {
    return window.umarDesktop!.vaultExists();
  }
  return !!localStorage.getItem(BROWSER_VAULT_KEY);
}

export async function getVaultMeta(): Promise<VaultMeta | null> {
  if (hasDesktopVaultApi()) {
    return window.umarDesktop!.vaultMeta();
  }
  const raw = localStorage.getItem(BROWSER_VAULT_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as VaultMeta & { emailHint?: string };
    return {
      emailHint: p.emailHint,
      companyId: p.companyId,
      updatedAt: p.updatedAt,
    };
  } catch {
    return null;
  }
}

export async function saveCredentialVault(payload: {
  pin: string;
  email: string;
  password: string;
  companyId?: string | null;
  userId?: string | null;
}) {
  if (hasDesktopVaultApi()) {
    return window.umarDesktop!.vaultSave(payload);
  }
  return saveBrowserVault(payload);
}

export async function unlockCredentialVault(pin: string) {
  if (hasDesktopVaultApi()) {
    return window.umarDesktop!.vaultUnlock(pin);
  }
  return unlockBrowserVault(pin);
}

export async function clearCredentialVault() {
  if (hasDesktopVaultApi()) {
    return window.umarDesktop!.vaultClear();
  }
  localStorage.removeItem(BROWSER_VAULT_KEY);
  return { ok: true };
}

export function shouldOfferPinVault() {
  // Offer on Electron desktop always; also allow browser for PWA testing.
  return isElectronRuntime() || hasDesktopVaultApi() || typeof window !== "undefined";
}
