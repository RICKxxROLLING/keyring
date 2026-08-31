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

/**
 * Every cache this app writes. Kept in one place so a new cache added to
 * sw.js cannot be forgotten here — a forgotten cache is tenant PII that
 * outlives logout.
 */
export const OFFLINE_CACHES = [
  "keyring-shell-v1",
  "keyring-api-v1",
  "keyring-thumbs-v1",
] as const;

/**
 * Wipe the offline caches. Called on logout, because the API cache holds whole
 * property dossiers — names, phones, emails, lease terms, deposits — and they
 * otherwise persist on the device indefinitely.
 *
 * Deliberately best-effort and never throws: Cache Storage is absent in some
 * private-browsing modes and throws when the browser is set to block site
 * data, and a storage failure must not strand someone mid-logout.
 *
 * Also sweeps any cache whose name starts with `keyring-`, so a stale cache
 * left behind by an older version (say `keyring-api-v0`) is cleared too.
 */
export async function clearOfflineCaches(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith("keyring-") || (OFFLINE_CACHES as readonly string[]).includes(n))
        .map((n) => caches.delete(n)),
    );
  } catch {
    // Storage unavailable or blocked. Nothing more we can do from here.
  }
}
