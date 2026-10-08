/**
 * Desktop credential vault (Electron main process).
 * Stores PIN-wrapped email/password on disk. Ciphertext is additionally
 * protected with Electron safeStorage when available.
 */
const { safeStorage, app } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const VAULT_VERSION = 1;
const PBKDF2_ITERATIONS = 120_000;
const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;

function vaultPath() {
  return path.join(app.getPath("userData"), "credential-vault.bin");
}

function metaPath() {
  return path.join(app.getPath("userData"), "credential-vault.meta.json");
}

function deriveKey(pin, salt) {
  return crypto.pbkdf2Sync(String(pin), salt, PBKDF2_ITERATIONS, KEY_LEN, "sha256");
}

function encryptAesGcm(key, plaintext) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

function decryptAesGcm(key, blob) {
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + 16);
  const data = blob.subarray(IV_LEN + 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function wrapForDisk(buffer) {
  if (safeStorage.isEncryptionAvailable()) {
    return Buffer.concat([
      Buffer.from([1]), // flag: safeStorage
      safeStorage.encryptString(buffer.toString("base64")),
    ]);
  }
  return Buffer.concat([Buffer.from([0]), buffer]);
}

function unwrapFromDisk(fileBuf) {
  const flag = fileBuf[0];
  const rest = fileBuf.subarray(1);
  if (flag === 1) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS secure storage unavailable");
    }
    const b64 = safeStorage.decryptString(rest);
    return Buffer.from(b64, "base64");
  }
  return rest;
}

function vaultExists() {
  return fs.existsSync(vaultPath()) && fs.existsSync(metaPath());
}

function readMeta() {
  if (!fs.existsSync(metaPath())) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath(), "utf8"));
  } catch {
    return null;
  }
}

function writeMeta(patch) {
  const prev = readMeta() || {};
  fs.writeFileSync(
    metaPath(),
    JSON.stringify({ ...prev, ...patch, v: VAULT_VERSION }, null, 2),
    "utf8",
  );
}

const PIN_PATTERN = /^\d{4,6}$/;
const MAX_PIN_ATTEMPTS = 5;

function pinError() {
  return "PIN must be 4–6 digits";
}

function lockRemainingMs(meta) {
  const until = meta && meta.lockedUntil ? Date.parse(meta.lockedUntil) : 0;
  if (!until || Number.isNaN(until)) return 0;
  return Math.max(0, until - Date.now());
}

/**
 * @param {{ pin: string, email: string, password: string, companyId?: string|null, userId?: string|null }} payload
 */
function saveVault(payload) {
  const pin = String(payload.pin || "");
  const email = String(payload.email || "").trim();
  const password = String(payload.password || "");
  if (!PIN_PATTERN.test(pin)) {
    return { ok: false, error: pinError() };
  }
  if (!email || !password) {
    return { ok: false, error: "Sign in before saving a PIN" };
  }

  const salt = crypto.randomBytes(SALT_LEN);
  const key = deriveKey(pin, salt);
  const json = JSON.stringify({
    v: VAULT_VERSION,
    email,
    password,
    companyId: payload.companyId || null,
    userId: payload.userId || null,
    savedAt: new Date().toISOString(),
  });
  const sealed = encryptAesGcm(key, json);
  const disk = wrapForDisk(Buffer.concat([salt, sealed]));
  fs.writeFileSync(vaultPath(), disk);
  fs.writeFileSync(
    metaPath(),
    JSON.stringify(
      {
        v: VAULT_VERSION,
        emailHint: email.replace(/(^.).*(@.*$)/, "$1***$2"),
        accountEmail: email.toLowerCase(),
        companyId: payload.companyId || null,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
  return { ok: true };
}

/**
 * @param {string} pin
 */
function unlockVault(pin) {
  if (!vaultExists()) {
    return { ok: false, error: "No saved credentials" };
  }
  const meta = readMeta() || {};
  const wait = lockRemainingMs(meta);
  if (wait > 0) {
    const secs = Math.ceil(wait / 1000);
    return { ok: false, error: `Too many attempts. Try again in ${secs}s.` };
  }
  if (!PIN_PATTERN.test(String(pin || ""))) {
    return { ok: false, error: pinError() };
  }
  try {
    const raw = unwrapFromDisk(fs.readFileSync(vaultPath()));
    const salt = raw.subarray(0, SALT_LEN);
    const sealed = raw.subarray(SALT_LEN);
    const key = deriveKey(pin, salt);
    const json = decryptAesGcm(key, sealed);
    const data = JSON.parse(json);
    writeMeta({ failedAttempts: 0, lockedUntil: null });
    return {
      ok: true,
      email: data.email,
      password: data.password,
      companyId: data.companyId || null,
      userId: data.userId || null,
    };
  } catch {
    const fails = (Number(meta.failedAttempts) || 0) + 1;
    const patch = { failedAttempts: fails, lockedUntil: null };
    if (fails >= MAX_PIN_ATTEMPTS) {
      const lockMs = Math.min(15 * 60 * 1000, 60_000 * 2 ** (fails - MAX_PIN_ATTEMPTS));
      patch.lockedUntil = new Date(Date.now() + lockMs).toISOString();
    }
    writeMeta(patch);
    if (patch.lockedUntil) {
      return { ok: false, error: "Too many attempts. Try again in 60s, or sign in with email." };
    }
    return { ok: false, error: "Incorrect PIN" };
  }
}

function clearVault() {
  try {
    if (fs.existsSync(vaultPath())) fs.unlinkSync(vaultPath());
    if (fs.existsSync(metaPath())) fs.unlinkSync(metaPath());
  } catch {
    // ignore
  }
  return { ok: true };
}

function registerVaultIpc(ipcMain) {
  ipcMain.handle("vault:exists", () => vaultExists());
  ipcMain.handle("vault:meta", () => readMeta());
  ipcMain.handle("vault:save", (_e, payload) => saveVault(payload));
  ipcMain.handle("vault:unlock", (_e, pin) => unlockVault(pin));
  ipcMain.handle("vault:clear", () => clearVault());
  ipcMain.handle("desktop:isOnline", () => {
    try {
      const { net } = require("electron");
      return net.isOnline();
    } catch {
      return true;
    }
  });
}

module.exports = {
  vaultExists,
  readMeta,
  saveVault,
  unlockVault,
  clearVault,
  registerVaultIpc,
};
