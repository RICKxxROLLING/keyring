// web/lib/offline.ts — service worker registration + online state (owner T4). See design §C10.7.
import { useEffect, useState } from "react";

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline read is a courtesy, not a requirement — a failed registration is non-fatal.
    });
  });
}

/** True when the browser reports it has no network connection. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}

const LAST_SEEN_KEY = "keyring:last-online-at";

/** Records "now" as the last moment we were confirmed online; read it back while offline. */
export function markLastOnline(): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
  } catch {
    // storage may be unavailable (private mode); the banner just omits the timestamp
  }
}

export function getLastOnline(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}
