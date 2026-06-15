"use client";

/**
 * Registers the display service worker (public/sw.js) once, after load, on
 * secure origins only. Best-effort: a failure never affects the page. The SW
 * gives /d and /s offline resilience; see public/sw.js for the cache strategy.
 */
import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const secure =
      window.location.protocol === "https:" || window.location.hostname === "localhost";
    if (!secure) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // best-effort — offline resilience is a nicety, never a blocker
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
