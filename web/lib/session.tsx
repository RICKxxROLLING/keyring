// web/lib/session.tsx — auth context (owner T4). See design §C6.6 (T1 auth routes).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SessionInfo } from "../../shared/types";
import { apiGet, apiPost, setUnauthenticatedHandler } from "./api";

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

export function SessionProvider(props: { children: ReactNode }): JSX.Element {
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
