"use client";

import { useEffect } from "react";

const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      // In development, unregister any previously installed service worker
      // and clear its caches so hot reload always serves fresh assets.
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => registration.unregister());
      });
      if ("caches" in window) {
        caches.keys().then((keys) => {
          keys.forEach((key) => caches.delete(key));
        });
      }
      return;
    }

    // Defer registration until after `load`. The SW install fetches /sw.js,
    // parses it, and runs install hooks — all of which compete with the
    // main bundle for parser time. Yielding until window.load means cold
    // interactivity isn't delayed by SW setup. If `load` already fired by
    // the time this useEffect runs (likely under Suspense), register
    // immediately.
    const register = () => {
      navigator.serviceWorker
        .register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` })
        .catch((error) => {
          console.error("Service Worker registration failed:", error);
        });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
