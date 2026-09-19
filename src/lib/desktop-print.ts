/**
 * In Electron, replace window.print() with a PDF preview flow so Windows
 * does not show “This app doesn’t support print preview”.
 */

type DesktopPrintBridge = {
  isDesktop?: boolean;
  printPreview?: () => Promise<{ ok?: boolean; error?: string | null }>;
  print?: () => Promise<{ ok?: boolean; error?: string | null }>;
};

let installed = false;

export function installDesktopPrint() {
  if (typeof window === "undefined" || installed) return;
  const desktop = (window as Window & { umarDesktop?: DesktopPrintBridge })
    .umarDesktop;
  if (!desktop?.isDesktop) return;

  installed = true;
  const nativePrint = window.print.bind(window);

  window.print = () => {
    const run = async () => {
      try {
        if (desktop.printPreview) {
          const res = await desktop.printPreview();
          if (res?.ok) return;
        }
        if (desktop.print) {
          await desktop.print();
          return;
        }
      } catch (err) {
        console.warn("[desktop-print] fallback to window.print", err);
      }
      nativePrint();
    };
    void run();
  };
}
