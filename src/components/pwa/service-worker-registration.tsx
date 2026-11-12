"use client";

import { useEffect } from "react";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PWA Service Worker Registration
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Registers `public/sw.js` once per browser session.
 *
 * Why this component exists:
 *   The Web Share Target POST is handled by the service worker, not by a page.
 *   Android Chrome will only route a share to the installed PWA after the
 *   worker has been registered and has taken control of the scope.
 *
 * Important:
 *   - The worker intentionally does not cache authenticated navigations.
 *   - `updateViaCache: "none"` ensures a new `sw.js` is fetched from the
 *     network instead of a stale HTTP cache entry.
 *   - Registration failure must not break the rest of the app; it only makes
 *     the share target unavailable until the next successful load.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    let cancelled = false;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });

        // A background update check keeps an already-installed PWA current.
        // The worker calls skipWaiting(), so the new version can take over.
        if (!cancelled) {
          registration.update().catch(() => {
            // Offline or a transient network failure: the active worker stays.
          });
        }
      } catch (error) {
        // This is expected in unsupported browsers or insecure contexts.
        console.warn("[pwa] Service worker registration failed:", error);
      }
    };

    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
