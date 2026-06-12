"use client";

import { useEffect } from "react";

// Registers the service worker so the app is installable. Browsers only allow
// service workers in a secure context (HTTPS or localhost), so over a plain
// LAN address this is a no-op — the app still works, just isn't installable.
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator) ||
      !window.isSecureContext
    ) {
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration is best-effort; ignore failures.
    });
  }, []);

  return null;
}
