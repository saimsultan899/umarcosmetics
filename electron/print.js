/**
 * Desktop printing for Electron.
 * Chromium print-preview UI is not shipped in Electron, so Windows 11 shows
 * "This app doesn't support print preview". We generate a PDF preview instead.
 */
const { BrowserWindow, Menu } = require("electron");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

function registerPrintIpc(ipcMain, log = console.log) {
  ipcMain.handle("desktop:print", async (event) => {
    const wc = event.sender;
    return await new Promise((resolve) => {
      wc.print(
        {
          silent: false,
          printBackground: true,
          deviceName: "",
        },
        (success, failureReason) => {
          resolve({ ok: !!success, error: failureReason || null });
        },
      );
    });
  });

  ipcMain.handle("desktop:printPreview", async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
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
                    { silent: false, printBackground: true },
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
      // Fallback: system print dialog
      return await new Promise((resolve) => {
        event.sender.print(
          { silent: false, printBackground: true },
          (success, failureReason) => {
            resolve({
              ok: !!success,
              error: failureReason || String(err?.message || err),
              fallback: true,
            });
          },
        );
      });
    }
  });
}

module.exports = { registerPrintIpc };
