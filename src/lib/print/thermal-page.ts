/**
 * Print the on-screen walk-in slip.
 *
 * Must stay synchronous from the Print click (or Ctrl+P). Awaiting fonts /
 * frames before print() drops the user gesture, so Chromium silently skips
 * the dialog — that is why thermal looked broken while standard still worked.
 *
 * Electron hooks window.print() and detects `.thermal-80` / thermal-print-mode.
 */

export function printThermalSlip(_source?: HTMLElement | null) {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  const root = document.documentElement;
  root.classList.add("thermal-print-mode");

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    root.classList.remove("thermal-print-mode");
    window.removeEventListener("afterprint", cleanup);
  };

  window.addEventListener("afterprint", cleanup);
  // Electron print IPC may not always fire afterprint — clear the class anyway.
  window.setTimeout(cleanup, 60_000);

  window.print();
}
