/// <reference lib="webworker" />

/**
 * Umar Distribution Software — Service Worker
 *
 * Caches the app shell (HTML, JS, CSS, fonts, icons) so the PWA
 * can open and render its full UI when offline.
 *
 * Strategy:
 *  - INSTALL  → pre-cache critical shell assets
 *  - ACTIVATE → purge old caches
 *  - FETCH    → network-first for navigations (HTML),
 *               cache-first for static assets (JS/CSS/fonts/images)
 *               never intercept Supabase API calls
 */

/**
 * Cache version — keep aligned with package.json. Changing these bytes is
 * what makes the browser install a new worker; `activate` then purges the
 * old cache. The client also probes /api/app-version on reconnect, so a
 * deploy that bumps NEXT_PUBLIC_APP_VERSION still prompts even if this
 * string was forgotten.
 */
const CACHE_VERSION = "0.1.0";
const CACHE_NAME = `umar-shell-${CACHE_VERSION}`;

/** Assets to pre-cache on install (app shell). */
const PRECACHE_URLS = [
  "/",
  "/dashboard",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// ── Install ──────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  // Note: we do NOT skipWaiting() automatically here. The new worker waits so
  // that in-flight offline writes are never interrupted mid-session. The app
  // shell decides when to activate it (via the SKIP_WAITING message below),
  // typically prompting the user or applying on the next launch.
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

// ── Message: allow the app to activate a waiting worker on demand ────
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ── Activate ─────────────────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept Supabase, app APIs (version check, sync), auth, or realtime.
  // App-version must always hit the network so a reconnect can detect a new deploy.
  if (
    url.hostname.includes("supabase") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth") ||
    url.pathname.startsWith("/rest") ||
    url.pathname.startsWith("/realtime")
  ) {
    return;
  }

  // Never intercept non-GET requests
  if (event.request.method !== "GET") return;

  // ── Static assets: cache-first ────────────────────────────────────
  if (
    url.pathname.startsWith("/_next/static") ||
    url.pathname.startsWith("/icons") ||
    url.pathname.startsWith("/images") ||
    url.pathname.match(/\.(js|css|woff2?|ttf|otf|png|jpg|jpeg|svg|webp|ico)$/)
  ) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
          }).catch(() => new Response("", { status: 503 }))
      )
    );
    return;
  }

  // ── Navigation requests (HTML pages): network-first, cache-fallback ─
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache a clone of successful navigations for offline
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() =>
          // Offline: try returning cached page, or the cached root shell
          caches.match(event.request).then(
            (cached) => cached || caches.match("/dashboard")
          ).then((fallback) => fallback || new Response(
            `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Offline</title></head>
             <body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f4f7f6">
             <div style="text-align:center"><h1>📡 Offline</h1><p>Waiting for internet connection…</p>
             <p style="color:#666">Your data is safely saved locally.</p></div></body></html>`,
            { status: 200, headers: { "Content-Type": "text/html" } }
          ))
        )
    );
    return;
  }

  // ── Everything else: network-first ────────────────────────────────
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
      .then((r) => r || new Response("", { status: 503 }))
  );
});
