/** Service worker helpers — PWA only; Electron uses a local Next server. */

export function isElectronRuntime() {
  return (
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("electron")
  );
}

// ── PWA update plumbing ─────────────────────────────────────────────

let swRegistration: ServiceWorkerRegistration | null = null;
let applyingUpdate = false;
type PwaUpdateListener = (ready: boolean) => void;
const updateListeners = new Set<PwaUpdateListener>();

function notifyUpdateListeners(ready: boolean) {
  updateListeners.forEach((cb) => {
    try {
      cb(ready);
    } catch {
      /* ignore listener errors */
    }
  });
}

/**
 * Subscribe to "a new app version is waiting to activate" for the PWA.
 * Returns an unsubscribe function. Fires with `true` once a new worker is
 * installed and waiting.
 */
export function onPwaUpdateReady(cb: PwaUpdateListener) {
  updateListeners.add(cb);
  // Fire immediately if one is already waiting.
  if (swRegistration?.waiting) cb(true);
  return () => updateListeners.delete(cb);
}

/** Ask the browser to re-check /sw.js for a newer app shell. */
export async function checkForPwaUpdate() {
  if (!swRegistration) return;
  try {
    await swRegistration.update();
  } catch {
    /* offline / non-critical */
  }
}

/**
 * Activate a waiting worker and reload once it takes control. Called when the
 * user chooses to apply the update. Safe: offline writes live in IndexedDB /
 * the outbox, which persist across the reload.
 */
export function applyPwaUpdate() {
  const waiting = swRegistration?.waiting;
  if (!waiting) return;
  applyingUpdate = true;
  waiting.postMessage({ type: "SKIP_WAITING" });
}

function watchRegistration(reg: ServiceWorkerRegistration) {
  swRegistration = reg;
  if (reg.waiting) notifyUpdateListeners(true);
  reg.addEventListener("updatefound", () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      // A new worker finished installing while an old one still controls the
      // page → an update is waiting.
      if (installing.state === "installed" && navigator.serviceWorker.controller) {
        notifyUpdateListeners(true);
      }
    });
  });
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
    const reg = await navigator.serviceWorker.register("/sw.js");
    watchRegistration(reg);

    // Reload once a freshly-activated worker takes control (only when the user
    // explicitly applied an update, to avoid surprise reloads mid-work).
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (applyingUpdate) {
        applyingUpdate = false;
        window.location.reload();
      }
    });
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
