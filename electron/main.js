const { app, BrowserWindow, shell, ipcMain, dialog, net } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const netTcp = require("net");
const fs = require("fs");
const { registerVaultIpc } = require("./vault");
const { registerPrintIpc } = require("./print");
const { registerDbIpc, getPendingSyncCount } = require("./db");
const {
  registerUpdaterIpc,
  initAutoUpdater,
  checkForUpdates,
} = require("./updater");

// Cloudflare / HTTP3 can intermittently fail inside Electron on some Windows networks
app.commandLine.appendSwitch("disable-quic");

// ── Configuration ───────────────────────────────────────────────────

const PORT = 3456; // Local Next.js port (avoid conflict with dev 3000)
const HOST = "127.0.0.1";
const APP_NAME = "Umar Distribution Software";
// PowerShell does not honor `set ELECTRON_DEV=1`; treat unpackaged runs as dev.
const IS_DEV =
  process.env.ELECTRON_DEV === "1" ||
  process.env.ELECTRON_DEV === "true" ||
  !app.isPackaged;

let mainWindow = null;
let nextProcess = null;
let serverReady = false;
let nextExitCode = null;

registerVaultIpc(ipcMain);

function getLogPath() {
  try {
    return path.join(app.getPath("userData"), "startup.log");
  } catch (_) {
    return path.join(process.cwd(), "startup.log");
  }
}

function log(msg) {
  const logMsg = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(msg);
  try {
    fs.appendFileSync(getLogPath(), logMsg, "utf8");
  } catch (_) {}
}

registerPrintIpc(ipcMain, log);
registerDbIpc(ipcMain, log);
registerUpdaterIpc(ipcMain);
ipcMain.handle("app:getVersion", () => app.getVersion());

// Only one desktop instance — extra launches focus the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function getAppIconPath() {
  const packaged = path.join(process.resourcesPath || "", "srv", "public", "icons", "icon-512.png");
  const local = path.join(__dirname, "assets", "icon.png");
  const fallback = path.join(__dirname, "..", "public", "icons", "icon-512.png");
  if (fs.existsSync(packaged)) return packaged;
  if (fs.existsSync(local)) return local;
  if (fs.existsSync(fallback)) return fallback;
  return undefined;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = netTcp.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, HOST);
  });
}

function httpStatus(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on("error", () => resolve(0));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(0);
    });
  });
}

/**
 * Kill a previous packaged Next server left listening on PORT after a crash.
 * Only targets Electron-run-as-node children of this app (…\resources\srv\server.js).
 */
async function reclaimPackagedServerPort() {
  if (IS_DEV || process.platform !== "win32") return;
  const free = await isPortFree(PORT);
  if (free) return;

  log(`Port ${PORT} busy — checking for orphaned packaged Next server…`);
  try {
    const { execSync } = require("child_process");
    const out = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Umar Distribution Software.exe' -and $_.CommandLine -like '*resources\\\\srv\\\\server.js*' } | Select-Object -ExpandProperty ProcessId"`,
      { encoding: "utf8", windowsHide: true, timeout: 8000 },
    );
    const pids = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s));
    for (const pid of pids) {
      log(`Killing orphaned server PID ${pid}`);
      try {
        execSync(`taskkill /PID ${pid} /F`, { windowsHide: true });
      } catch (_) {}
    }
    // Brief settle time for the port to release
    await new Promise((r) => setTimeout(r, 400));
  } catch (err) {
    log(`reclaimPackagedServerPort: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Wait for Next.js server to be ready ─────────────────────────────

function waitForServer(url, timeout = 90000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let lastError = null;
    const check = () => {
      if (nextExitCode != null && !serverReady) {
        reject(
          new Error(
            `Next server exited early (code ${nextExitCode}). Last error: ${lastError || "none"}`,
          ),
        );
        return;
      }
      http
        .get(url, (res) => {
          log(`HTTP check ${url} responded with status: ${res.statusCode}`);
          res.resume();
          if (res.statusCode >= 200 && res.statusCode < 500) {
            serverReady = true;
            resolve();
          } else {
            retry();
          }
        })
        .on("error", (err) => {
          lastError = err.message;
          retry();
        });
    };
    const retry = () => {
      if (Date.now() - start > timeout) {
        log(`waitForServer timed out after ${timeout}ms. Last error: ${lastError}`);
        reject(new Error(`Server startup timeout (last: ${lastError})`));
        return;
      }
      setTimeout(check, 400);
    };
    check();
  });
}

// ── Start the embedded Next.js server ───────────────────────────────

function startNextServer() {
  log(`Starting Next server... IS_DEV=${IS_DEV}`);
  serverReady = false;
  nextExitCode = null;
  if (IS_DEV) {
    const projectRoot = path.resolve(__dirname, "..");
    const nextBin = path.join(projectRoot, "node_modules", ".bin", "next");
    nextProcess = spawn(nextBin, ["dev", "-p", String(PORT), "-H", HOST], {
      cwd: projectRoot,
      env: { ...process.env, PORT: String(PORT), HOSTNAME: HOST },
      shell: true,
      stdio: "pipe",
    });

    nextProcess.stdout?.on("data", (data) => {
      log(`[Next.js stdout] ${data.toString().trim()}`);
    });

    nextProcess.stderr?.on("data", (data) => {
      log(`[Next.js stderr] ${data.toString().trim()}`);
    });

    nextProcess.on("close", (code) => {
      nextExitCode = code;
      log(`[Next.js] Server closed with code ${code}`);
      nextProcess = null;
    });

    nextProcess.on("error", (err) => {
      log(`[Next.js] Failed to start: ${err.message}`);
    });
  } else {
    // In production, execute the standalone Next.js server using Electron's bundled Node
    // (enabled via runAsNode fuse). Packaged as resources/srv (short path for Windows).
    const serverDir = path.join(process.resourcesPath, "srv");
    const serverPath = path.join(serverDir, "server.js");
    const nextModule = path.join(serverDir, "node_modules", "next");

    log(`Production server path: ${serverPath}`);
    log(
      `Production server dir exists: ${fs.existsSync(serverDir)}, file exists: ${fs.existsSync(serverPath)}, next exists: ${fs.existsSync(nextModule)}`,
    );

    if (!fs.existsSync(serverPath)) {
      throw new Error(
        `Missing server.js in resources/srv. Rebuild with: npm run electron:build`,
      );
    }
    if (!fs.existsSync(nextModule)) {
      throw new Error(
        `Missing node_modules/next in resources/srv (packaging incomplete). Rebuild with: npm run electron:build`,
      );
    }

    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(PORT),
      HOSTNAME: HOST,
      NODE_ENV: "production",
    };

    try {
      log(`Spawning server process: ${process.execPath} -> ${serverPath}`);
      nextProcess = spawn(process.execPath, [serverPath], {
        cwd: serverDir,
        env,
        stdio: "pipe",
      });

      nextProcess.stdout?.on("data", (data) => {
        log(`[Next.js stdout] ${data.toString().trim()}`);
      });

      nextProcess.stderr?.on("data", (data) => {
        log(`[Next.js stderr] ${data.toString().trim()}`);
      });

      nextProcess.on("close", (code) => {
        nextExitCode = code;
        log(`[Next.js] Server closed with code ${code}`);
        nextProcess = null;
      });

      nextProcess.on("error", (err) => {
        log(`[Next.js] Failed to start: ${err.message}`);
      });
    } catch (err) {
      log(`[Next.js] Exception launching server: ${err.message}`);
      dialog.showErrorBox(
        "Server Error",
        `Failed to start the application server.\n\n${err.message}`,
      );
      throw err;
    }
  }
}

function getAppLogoDataUri() {
  const iconPath = getAppIconPath();
  if (iconPath && fs.existsSync(iconPath)) {
    try {
      const ext = path.extname(iconPath).toLowerCase();
      const mime = ext === ".svg" ? "image/svg+xml" : "image/png";
      const b64 = fs.readFileSync(iconPath).toString("base64");
      return `data:${mime};base64,${b64}`;
    } catch (e) {
      log(`getAppLogoDataUri failed: ${e.message}`);
    }
  }
  return "";
}

function loadingPageUrl(message) {
  const logoUri = getAppLogoDataUri();
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${APP_NAME}</title><style>
html,body{margin:0;padding:0;width:100%;height:100%;background:#ffffff;display:flex;justify-content:center;align-items:center;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
.loader{display:flex;flex-direction:column;align-items:center;justify-content:center}
.logo{width:88px;height:88px;object-fit:contain;margin-bottom:28px;user-select:none;-webkit-user-drag:none;border-radius:18px;box-shadow:0 4px 16px rgba(0,0,0,0.06)}
.spinner{width:36px;height:36px;border:3px solid #f1f5f9;border-top-color:#d65a42;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body><div class="loader">
${logoUri ? `<img src="${logoUri}" class="logo" alt="${APP_NAME}"/>` : ""}
<div class="spinner"></div>
</div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function ensureWindowVisible() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.isVisible()) {
    log("Forcing window show (ready-to-show may not have fired)");
    mainWindow.show();
  }
  mainWindow.focus();
}

// ── Create main window ──────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    icon: getAppIconPath(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    titleBarStyle: "default",
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
  });

  mainWindow.once("ready-to-show", () => {
    log("ready-to-show");
    ensureWindowVisible();
  });

  // Never leave the user with an invisible window
  setTimeout(() => ensureWindowVisible(), 2500);

  mainWindow.webContents.on("console-message", (event) => {
    try {
      const level = event.level ?? 0;
      const message = event.message ?? "";
      if (level >= 2 && message) {
        log(`[Renderer:${level}] ${message}`);
      }
    } catch (_) {}
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    // Ignore aborted navigations (superseded by a later loadURL)
    if (code === -3) return;
    log(`did-fail-load code=${code} desc=${desc} url=${url}`);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    const url = mainWindow?.webContents.getURL() || "";
    log(`did-finish-load ${url.slice(0, 120)}`);
    ensureWindowVisible();
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F12") {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http") && !url.includes(`${HOST}:${PORT}`)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function loadAppUi() {
  const appUrl = `http://${HOST}:${PORT}/login`;
  log(`Loading UI ${appUrl}`);
  if (!mainWindow || mainWindow.isDestroyed()) return;

  try {
    const ses = mainWindow.webContents?.session;
    if (ses) {
      const urls = [
        `http://${HOST}:${PORT}`,
        `http://${HOST}:${PORT}/`,
        `http://127.0.0.1:${PORT}`,
        `http://127.0.0.1:${PORT}/`,
        `http://localhost:${PORT}`,
        `http://localhost:${PORT}/`,
      ];
      for (const u of urls) {
        const cookies = await ses.cookies.get({ url: u }).catch(() => []);
        for (const c of cookies) {
          await ses.cookies.remove(`${u.replace(/\/$/, "")}${c.path || "/"}`, c.name).catch(() => {});
        }
      }
    }
  } catch (_) {}

  try {
    await mainWindow.loadURL(appUrl);
    ensureWindowVisible();
  } catch (err) {
    log(`loadURL failed: ${err instanceof Error ? err.message : String(err)}`);
    // Retry once after a short delay
    await new Promise((r) => setTimeout(r, 800));
    if (!mainWindow || mainWindow.isDestroyed()) return;
    await mainWindow.loadURL(`http://${HOST}:${PORT}/login`);
    ensureWindowVisible();
  }
}

// ── App lifecycle ───────────────────────────────────────────────────

if (gotLock) {
  app.whenReady().then(async () => {
    log(`net.isOnline=${net.isOnline()}`);
    createWindow();

    await mainWindow.loadURL(loadingPageUrl("Starting application…"));
    ensureWindowVisible();

    try {
      await reclaimPackagedServerPort();
      if (!(await isPortFree(PORT))) {
        const status = await httpStatus(`http://${HOST}:${PORT}/login`);
        log(
          `Port ${PORT} still busy before spawn (HTTP ${status || "none"}). Reclaim may have failed.`,
        );
      }
      startNextServer();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`startNextServer failed: ${message}`);
      dialog.showErrorBox(
        "Startup Failed",
        `Could not start the application server.\n\n${message}`,
      );
      app.quit();
      return;
    }

    try {
      await waitForServer(`http://${HOST}:${PORT}`);

      // Child died (often EADDRINUSE) — only continue if something healthy still answers.
      if (nextExitCode != null && nextExitCode !== 0) {
        const status = await httpStatus(`http://${HOST}:${PORT}/login`);
        if (status < 200 || status >= 500) {
          throw new Error(
            `Next server failed to bind port ${PORT}. Close other Umar Distribution windows and retry.`,
          );
        }
        log(`Using existing server on port ${PORT} (HTTP ${status})`);
      }

      await loadAppUi();

      // Auto-update: safe no-op in dev / when unconfigured. The local SQLite
      // ledger lives in userData and survives reinstalls, so applying an
      // update never disturbs unsynced offline writes.
      try {
        initAutoUpdater({
          getWindow: () => mainWindow,
          log,
          getPendingSyncCount,
          isPackaged: app.isPackaged,
        });
        // Initial check shortly after the UI settles.
        setTimeout(() => void checkForUpdates("startup"), 8000);
      } catch (updErr) {
        log(`auto-updater init failed: ${updErr instanceof Error ? updErr.message : String(updErr)}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Startup failed: ${message}`);
      dialog.showErrorBox(
        "Startup Failed",
        `Could not start the application server.\n\nPlease close every “Umar Distribution” window, then reopen.\n\nError: ${message}`,
      );
      app.quit();
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        void loadAppUi();
      }
    });
  });
}

// ── Quit ─────────────────────────────────────────────────────────────

app.on("window-all-closed", () => {
  if (nextProcess) {
    try {
      nextProcess.kill();
    } catch (_) {}
    nextProcess = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (nextProcess) {
    try {
      nextProcess.kill();
    } catch (_) {}
    nextProcess = null;
  }
});
