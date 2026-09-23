/**
 * Auto-update mechanism for the packaged desktop app (NSIS / electron-updater).
 *
 * Flow (see requirements — "Offline App Auto-Update Mechanism"):
 *  1. Detect: on launch and whenever connectivity returns, check the update
 *     feed for a newer published version.
 *  2. Pull: download the new build in the background (non-blocking).
 *  3. Apply: notify the renderer when a build is ready. The user applies it
 *     with a single click ("Restart & update"), or it installs automatically on
 *     the next natural quit (autoInstallOnAppQuit).
 *
 * Data safety:
 *  - The local SQLite ledger lives in userData/data (outside the install dir),
 *    so an NSIS in-place upgrade never touches it — unsynced offline writes
 *    survive the update.
 *  - Version-gated, additive schema migrations run on next launch (see db.js).
 *  - Before applying, we surface the count of unsynced records so the user is
 *    warned (data is preserved regardless, but syncing first is recommended)
 *    and so we never interrupt an in-flight sync unexpectedly.
 *
 * This module is a no-op in development (unpackaged) or when no update feed is
 * configured, so `npm run electron:dev` keeps working without a release server.
 */

const CHECK_THROTTLE_MS = 10 * 60 * 1000; // don't hammer the feed
const PERIODIC_CHECK_MS = 6 * 60 * 60 * 1000; // background re-check every 6h

let autoUpdater = null;
let logFn = console.log;
let getWindow = () => null;
let getPendingSyncCount = () => 0;
let configured = false;
let lastCheckAt = 0;
let latestInfo = null;
let downloaded = false;
let periodicTimer = null;

function log(msg) {
  try {
    logFn(`[updater] ${msg}`);
  } catch (_) {}
}

function send(channel, payload) {
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    try {
      win.webContents.send(channel, payload);
    } catch (_) {}
  }
}

function loadAutoUpdater() {
  if (autoUpdater) return autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (err) {
    log(`electron-updater not available: ${err instanceof Error ? err.message : String(err)}`);
    autoUpdater = null;
  }
  return autoUpdater;
}

/**
 * @param {object} opts
 * @param {() => import('electron').BrowserWindow | null} opts.getWindow
 * @param {(msg: string) => void} opts.log
 * @param {() => number} [opts.getPendingSyncCount]
 * @param {boolean} opts.isPackaged
 */
function initAutoUpdater(opts) {
  getWindow = opts.getWindow || getWindow;
  if (typeof opts.log === "function") logFn = opts.log;
  if (typeof opts.getPendingSyncCount === "function") {
    getPendingSyncCount = opts.getPendingSyncCount;
  }

  if (!opts.isPackaged) {
    log("dev build — auto-update disabled");
    return;
  }

  const updater = loadAutoUpdater();
  if (!updater) return;

  updater.logger = {
    info: (m) => log(String(m)),
    warn: (m) => log(`WARN ${m}`),
    error: (m) => log(`ERROR ${m}`),
    debug: () => {},
  };

  // Download automatically once an update is found, but never auto-restart
  // while the app is running. Deferred install happens on next quit.
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowDowngrade = false;

  // Optional runtime override of the feed URL (baked default lives in
  // electron-builder.json -> publish). Lets ops repoint the feed without a
  // rebuild, e.g. UMAR_UPDATE_FEED_URL=https://updates.example.com/latest
  const feedUrl = process.env.UMAR_UPDATE_FEED_URL;
  if (feedUrl) {
    try {
      updater.setFeedURL({ provider: "generic", url: feedUrl, channel: "latest" });
      log(`feed override: ${feedUrl}`);
    } catch (err) {
      log(`setFeedURL failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  updater.on("checking-for-update", () => {
    send("updater:event", { status: "checking" });
  });

  updater.on("update-available", (info) => {
    latestInfo = info;
    log(`update available: ${info?.version}`);
    send("updater:event", { status: "available", version: info?.version });
  });

  updater.on("update-not-available", (info) => {
    send("updater:event", { status: "up-to-date", version: info?.version });
  });

  updater.on("download-progress", (p) => {
    send("updater:event", {
      status: "downloading",
      percent: Math.round(p?.percent || 0),
      bytesPerSecond: p?.bytesPerSecond || 0,
      transferred: p?.transferred || 0,
      total: p?.total || 0,
    });
  });

  updater.on("update-downloaded", (info) => {
    downloaded = true;
    latestInfo = info;
    const pending = safePendingCount();
    log(`update downloaded: ${info?.version} (pendingUnsynced=${pending})`);
    send("updater:event", {
      status: "downloaded",
      version: info?.version,
      releaseNotes: typeof info?.releaseNotes === "string" ? info.releaseNotes : null,
      pendingUnsynced: pending,
    });
  });

  updater.on("error", (err) => {
    log(`error: ${err instanceof Error ? err.message : String(err)}`);
    send("updater:event", {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  });

  configured = true;
  log("initialized");

  // Periodic background checks while the app stays open.
  if (periodicTimer) clearInterval(periodicTimer);
  periodicTimer = setInterval(() => void checkForUpdates("periodic"), PERIODIC_CHECK_MS);
  if (periodicTimer.unref) periodicTimer.unref();

  watchConnectivity();
}

/**
 * Detect "back online" without relying on the renderer (the shop PC may sit
 * on the login screen, or Chromium's `online` event may not fire after a
 * flaky WAN). Poll Electron `net.isOnline` and also re-check after resume.
 * Data sync is a separate path (PowerSync / IndexedDB outbox) — this only
 * asks the update *feed* whether a newer binary exists.
 */
function watchConnectivity() {
  let net = null;
  let powerMonitor = null;
  try {
    ({ net, powerMonitor } = require("electron"));
  } catch (_) {
    return;
  }
  if (!net) return;

  let wasOnline = false;
  try {
    wasOnline = !!net.isOnline();
  } catch (_) {}

  const poll = setInterval(() => {
    let now = false;
    try {
      now = !!net.isOnline();
    } catch (_) {
      now = false;
    }
    if (now && !wasOnline) {
      log("connectivity restored — checking update feed");
      void checkForUpdates("online");
    }
    wasOnline = now;
  }, 30 * 1000);
  if (poll.unref) poll.unref();

  if (powerMonitor && typeof powerMonitor.on === "function") {
    powerMonitor.on("resume", () => {
      let online = false;
      try {
        online = !!net.isOnline();
      } catch (_) {}
      if (online) void checkForUpdates("resume");
    });
  }
}

function safePendingCount() {
  try {
    return Number(getPendingSyncCount() || 0);
  } catch (_) {
    return 0;
  }
}

/**
 * Trigger an update check. Safe to call often — throttled and guarded so it
 * silently no-ops in dev, when unconfigured, or when offline callers race.
 * @param {string} [reason] diagnostic label (startup | online | manual | periodic)
 * @param {boolean} [force] bypass the throttle (used for manual checks)
 */
async function checkForUpdates(reason = "manual", force = false) {
  if (!configured || !autoUpdater) return { ok: false, error: "updater not configured" };
  if (downloaded) {
    // Already have a build staged; just re-notify the renderer.
    send("updater:event", {
      status: "downloaded",
      version: latestInfo?.version,
      pendingUnsynced: safePendingCount(),
    });
    return { ok: true, alreadyDownloaded: true };
  }
  const now = Date.now();
  if (!force && now - lastCheckAt < CHECK_THROTTLE_MS) {
    return { ok: true, throttled: true };
  }
  lastCheckAt = now;
  log(`checking for updates (${reason})`);
  try {
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, updateInfo: result?.updateInfo };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`checkForUpdates failed: ${message}`);
    send("updater:event", { status: "error", message });
    return { ok: false, error: message };
  }
}

/**
 * Apply a downloaded update by quitting and installing. The local DB is in
 * userData and survives the reinstall; version-gated migrations run on the
 * next launch. `isSilent=false` shows the NSIS UI; the app relaunches after.
 */
function quitAndInstall() {
  if (!configured || !autoUpdater) return { ok: false, error: "updater not configured" };
  if (!downloaded) return { ok: false, error: "no update downloaded yet" };
  log(`quitAndInstall (pendingUnsynced=${safePendingCount()})`);
  // Small delay so the IPC reply flushes before the window tears down.
  setTimeout(() => {
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (err) {
      log(`quitAndInstall failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, 300);
  return { ok: true };
}

function getState() {
  return {
    configured,
    downloaded,
    version: latestInfo?.version || null,
    pendingUnsynced: safePendingCount(),
  };
}

function registerUpdaterIpc(ipcMain) {
  ipcMain.handle("updater:check", () => checkForUpdates("manual", true));
  ipcMain.handle("updater:quitAndInstall", () => quitAndInstall());
  ipcMain.handle("updater:getState", () => getState());
}

module.exports = {
  initAutoUpdater,
  checkForUpdates,
  quitAndInstall,
  getState,
  registerUpdaterIpc,
};
