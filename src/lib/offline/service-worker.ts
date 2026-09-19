/** Service worker helpers — PWA only; Electron uses a local Next server. */

export function isElectronRuntime() {
  return (
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("electron")
  );
}

/**
 * Register the PWA service worker in browsers.
 * In Electron, unregister any existing SW so it cannot intercept cloud API calls.
 */
export async function setupServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  if (isElectronRuntime()) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      // non-critical
    }
    return;
  }

  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch {
    // non-critical
  }
}

export function networkErrorMessage(err: { message?: string } | null | undefined) {
  const msg = err?.message || "";
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return "Cannot reach the cloud server. Check your internet connection and try again.";
  }
  return msg || "Something went wrong";
}
