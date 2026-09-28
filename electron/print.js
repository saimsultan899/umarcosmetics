/**
 * Desktop printing for Electron.
 * Chromium print-preview UI is not shipped in Electron, so Windows 11 shows
 * "This app doesn't support print preview". We generate a PDF preview instead.
 */
const { BrowserWindow, Menu } = require("electron");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

async function isThermalJob(wc) {
  try {
    return await wc.executeJavaScript(
      "Boolean(document.documentElement.classList.contains('thermal-print-mode') || document.querySelector('.print-sheet.thermal-80'))",
    );
  } catch {
    return false;
  }
}

/** 80mm width × measured slip height, in microns (Electron pageSize units). */
async function thermalPageSize(wc) {
  try {
    const mm = await wc.executeJavaScript(`(() => {
      const el = document.querySelector('.print-sheet.thermal-80');
      const attr = document.documentElement.getAttribute('data-thermal-page-mm');
      if (attr && Number(attr) > 0) return Number(attr);
      if (!el) return 120;
      const px = Math.max(el.scrollHeight, el.offsetHeight, 120);
      return Math.max(40, Math.ceil((px * 25.4) / 96) + 3);
    })()`);
    const heightMm = Math.max(45, Number(mm) || 120);
    return {
      width: 80000,
      height: Math.round(heightMm * 1000),
    };
  } catch {
    return { width: 80000, height: 120000 };
  }
}

async function printOptions(wc, thermal) {
  const options = {
    silent: false,
    printBackground: true,
    color: !thermal,
    deviceName: "",
    scaleFactor: 100,
    margins: { marginType: thermal ? "none" : "default" },
  };
  if (thermal) {
    options.pageSize = await thermalPageSize(wc);
  }
  return options;
}

function registerPrintIpc(ipcMain, log = console.log) {
  ipcMain.handle("desktop:print", async (event) => {
    const wc = event.sender;
    const thermal = await isThermalJob(wc);
    const options = await printOptions(wc, thermal);
    return await new Promise((resolve) => {
      wc.print(options, (success, failureReason) => {
        resolve({ ok: !!success, error: failureReason || null });
      });
    });
  });

  ipcMain.handle("desktop:printPreview", async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const thermal = await isThermalJob(event.sender);
    if (thermal) {
      const options = await printOptions(event.sender, true);
      return await new Promise((resolve) => {
        event.sender.print(options, (success, failureReason) => {
          resolve({
            ok: !!success,
            error: failureReason || null,
            thermal: true,
          });
        });
      });
    }
    try {
      const pdf = await event.sender.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        margins: { marginType: "default" },
      });

      const tmpDir = app.getPath("temp");
      const tmp = path.join(tmpDir, `umar-print-${Date.now()}.pdf`);
      fs.writeFileSync(tmp, pdf);

      const preview = new BrowserWindow({
        width: 960,
        height: 1100,
        minWidth: 640,
        minHeight: 480,
        parent: parent || undefined,
        modal: false,
        title: "Print Preview — Umar Distribution",
        autoHideMenuBar: false,
        backgroundColor: "#525659",
        webPreferences: {
          plugins: true,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

      preview.setMenu(
        Menu.buildFromTemplate([
          {
            label: "File",
            submenu: [
              {
                label: "Print…",
                accelerator: "CmdOrCtrl+P",
                click: () => {
                  preview.webContents.print(
                    {
                      silent: false,
                      printBackground: true,
                      color: true,
                      margins: { marginType: "default" },
                    },
                    () => {},
                  );
                },
              },
              {
                label: "Close",
                accelerator: "Escape",
                role: "close",
              },
            ],
          },
        ]),
      );

      const fileUrl = `file:///${tmp.replace(/\\/g, "/")}`;
      await preview.loadURL(fileUrl);
      preview.show();
      preview.focus();

      preview.on("closed", () => {
        try {
          fs.unlinkSync(tmp);
        } catch (_) {
          /* ignore */
        }
      });

      log(`[print] Preview opened ${tmp}`);
      return { ok: true };
    } catch (err) {
      log(`[print] Preview failed: ${err?.message || err}`);
      const options = await printOptions(event.sender, thermal);
      return await new Promise((resolve) => {
        event.sender.print(options, (success, failureReason) => {
          resolve({
            ok: !!success,
            error: failureReason || String(err?.message || err),
            fallback: true,
          });
        });
      });
    }
  });
}

module.exports = { registerPrintIpc };
