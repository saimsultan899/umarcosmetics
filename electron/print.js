/**
 * Desktop printing for Electron.
 * Chromium print-preview UI is not shipped in Electron, so Windows 11 shows
 * "This app doesn't support print preview". We generate a PDF preview instead.
 *
 * Paper size is taken from the invoice layout (thermal / A5 half-slip / A4)
 * so the user does not have to pick it in the printer dialog every time.
 */
const { BrowserWindow, Menu } = require("electron");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

/** @returns {'thermal' | 'a5' | 'a4'} */
async function detectPrintPaper(wc) {
  try {
    return await wc.executeJavaScript(`(() => {
      const forced = document.documentElement.getAttribute('data-print-paper');
      if (forced === 'thermal' || forced === 'a5' || forced === 'a4') return forced;
      if (document.documentElement.classList.contains('thermal-print-mode')) {
        return 'thermal';
      }
      const sheets = Array.from(document.querySelectorAll('.print-sheet')).filter(
        (el) => !el.classList.contains('print-skip'),
      );
      for (const el of sheets) {
        const paper = el.getAttribute('data-paper');
        if (paper === 'thermal' || paper === 'a5' || paper === 'a4') return paper;
        if (el.classList.contains('thermal-80')) return 'thermal';
        if (
          el.classList.contains('si-half') ||
          el.classList.contains('cdoc--half') ||
          el.classList.contains('doc--half')
        ) {
          return 'a5';
        }
      }
      return 'a4';
    })()`);
  } catch {
    return "a4";
  }
}

/**
 * 80mm × content height in microns.
 * Keep height tight — oversized pages make POS drivers feed blank head/tail
 * before the cutter. Cutter clearance (~2 lines) is already in `.th-cut-feed`.
 *
 * Windows POS drivers usually cut after the job. Prefer partial/full cut
 * without extra feed (GS V 1 / GS V 0). Avoid GS V 66 (feeds before cut).
 */
async function thermalPageSize(wc) {
  try {
    const mm = await wc.executeJavaScript(`(() => {
      const attr = document.documentElement.getAttribute('data-thermal-page-mm');
      if (attr && Number(attr) > 0) return Number(attr);
      const el = document.querySelector('.print-sheet.thermal-80');
      if (!el) return 60;
      const px = Math.max(el.scrollHeight, el.offsetHeight, 1);
      return Math.max(20, Math.ceil((px * 25.4) / 96));
    })()`);
    const heightMm = Math.max(20, Number(mm) || 60);
    return {
      width: 80000,
      height: Math.round(heightMm * 1000),
    };
  } catch {
    return { width: 80000, height: 80000 };
  }
}

async function printOptions(wc, paper) {
  const thermal = paper === "thermal";
  const a5 = paper === "a5";
  const options = {
    silent: false,
    printBackground: true,
    color: !thermal,
    deviceName: "",
    scaleFactor: 100,
    landscape: a5,
    margins: { marginType: thermal || a5 ? "none" : "default" },
  };
  if (thermal) {
    options.pageSize = await thermalPageSize(wc);
  } else if (a5) {
    // A5 landscape = 210mm × 148mm (half-A4 slip).
    options.pageSize = "A5";
  } else {
    options.pageSize = "A4";
  }
  return options;
}

async function pdfOptions(wc, paper) {
  const thermal = paper === "thermal";
  const a5 = paper === "a5";
  const options = {
    printBackground: true,
    preferCSSPageSize: true,
    landscape: a5,
    margins: { marginType: thermal || a5 ? "none" : "default" },
  };
  if (thermal) {
    options.pageSize = await thermalPageSize(wc);
  } else if (a5) {
    options.pageSize = "A5";
  } else {
    options.pageSize = "A4";
  }
  return options;
}

function registerPrintIpc(ipcMain, log = console.log) {
  ipcMain.handle("desktop:print", async (event) => {
    const wc = event.sender;
    const paper = await detectPrintPaper(wc);
    const options = await printOptions(wc, paper);
    log(`[print] Direct print paper=${paper}`);
    return await new Promise((resolve) => {
      wc.print(options, (success, failureReason) => {
        resolve({ ok: !!success, error: failureReason || null, paper });
      });
    });
  });

  ipcMain.handle("desktop:printPreview", async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const paper = await detectPrintPaper(event.sender);
    if (paper === "thermal") {
      const options = await printOptions(event.sender, paper);
      log(`[print] Thermal print paper=${paper}`);
      return await new Promise((resolve) => {
        event.sender.print(options, (success, failureReason) => {
          resolve({
            ok: !!success,
            error: failureReason || null,
            thermal: true,
            paper,
          });
        });
      });
    }
    try {
      const pdfOpts = await pdfOptions(event.sender, paper);
      const pdf = await event.sender.printToPDF(pdfOpts);

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
        title: `Print Preview — ${paper.toUpperCase()} — Umar Distribution`,
        autoHideMenuBar: false,
        backgroundColor: "#525659",
        webPreferences: {
          plugins: true,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

      const printFromPreview = async () => {
        const options = await printOptions(event.sender, paper);
        // PDF already sized; still pass matching page so the driver stays correct.
        preview.webContents.print(
          {
            silent: false,
            printBackground: true,
            color: true,
            landscape: options.landscape,
            pageSize: options.pageSize,
            margins: { marginType: paper === "a5" ? "none" : "default" },
          },
          () => {},
        );
      };

      preview.setMenu(
        Menu.buildFromTemplate([
          {
            label: "File",
            submenu: [
              {
                label: "Print…",
                accelerator: "CmdOrCtrl+P",
                click: () => {
                  void printFromPreview();
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

      log(`[print] Preview opened paper=${paper} ${tmp}`);
      return { ok: true, paper };
    } catch (err) {
      log(`[print] Preview failed: ${err?.message || err}`);
      const options = await printOptions(event.sender, paper);
      return await new Promise((resolve) => {
        event.sender.print(options, (success, failureReason) => {
          resolve({
            ok: !!success,
            error: failureReason || String(err?.message || err),
            fallback: true,
            paper,
          });
        });
      });
    }
  });
}

module.exports = { registerPrintIpc };
