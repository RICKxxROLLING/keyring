// web/lib/session.tsx — auth context (owner T4). See design §C6.6 (T1 auth routes).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type ReactElement,
} from "react";
import type { SessionInfo } from "../../shared/types";
import { apiGet, apiPost, setUnauthenticatedHandler } from "./api";
import { clearOfflineCaches } from "./offline";

export type SessionStatus = "loading" | "authenticated" | "unauthenticated";

interface SessionContextValue {
  session: SessionInfo | null;
  status: SessionStatus;
  needsSetup: boolean;
  refresh: () => Promise<void>;
  setSession: (s: SessionInfo | null) => void;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider(props: { children: ReactNode }): ReactElement {
  const [session, setSessionState] = useState<SessionInfo | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [needsSetup, setNeedsSetup] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const info = await apiGet<SessionInfo>("/api/auth/me");
      setSessionState(info);
      setStatus("authenticated");
    } catch {
      setSessionState(null);
      setStatus("unauthenticated");
      try {
        const setupStatus = await apiGet<{ needsSetup: boolean }>("/api/setup/status");
        setNeedsSetup(setupStatus.needsSetup);
      } catch {
        setNeedsSetup(false);
      }
    }
  }, []);

  useEffect(() => {
    setUnauthenticatedHandler(() => {
      setSessionState(null);
      setStatus("unauthenticated");
      // Expiry and revocation land here, not in logout() — and with a 14-day
      // TTL most sessions end this way, so this is the COMMON path. Without
      // it, the dossier cache (names, phones, lease terms) survives on the
      // device for every session that was not explicitly signed out.
      void clearOfflineCaches();
    });
    return () => setUnauthenticatedHandler(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setSession = useCallback((s: SessionInfo | null) => {
    setSessionState(s);
    setStatus(s ? "authenticated" : "unauthenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiPost("/api/auth/logout");
    } finally {
      setSessionState(null);
      setStatus("unauthenticated");
      // Clearing React state is not enough. The offline caches hold complete
      // dossier payloads — tenant names, phone numbers, email addresses, lease
      // terms, deposit amounts — and they survive logout, browser restart and
      // session expiry. On a shared or lost device that is real exposure of
      // someone else's personal data long after the person who signed in
      // believed they had signed out.
      //
      // Best-effort: Cache Storage is unavailable in a private window and
      // throws outright when site data is blocked, so a failure here must not
      // leave the user stuck on a half-completed logout.
      await clearOfflineCaches();
    }
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ session, status, needsSetup, refresh, setSession, logout }),
    [session, status, needsSetup, refresh, setSession, logout],
  );

  return <SessionContext.Provider value={value}>{props.children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
