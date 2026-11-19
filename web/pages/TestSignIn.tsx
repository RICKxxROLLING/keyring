import { useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Role, SessionInfo } from "../../shared/types";
import { apiGet, apiPost, ApiClientError } from "../lib/api";
import { Button } from "../components/Button";

interface TestAccount {
  id: string;
  displayName: string;
  role: Role;
}

/**
 * The test server's sign-in: pick a seeded account, no password.
 *
 * Shown only when the server says test sign-in is on (it never is in
 * production — see server/auth/test-signin.ts), so the ordinary form below it
 * is unchanged everywhere else.
 */
export function TestSignIn(props: { onSignedIn: (session: SessionInfo) => void }): ReactElement | null {
  const instance = useQuery({
    queryKey: ["instance"],
    queryFn: () => apiGet<{ instance: string | null; testSignIn?: boolean }>("/api/instance"),
    staleTime: Infinity,
    retry: false,
  });
  const enabled = instance.data?.testSignIn === true;
  const accounts = useQuery({
    queryKey: ["test-accounts"],
    queryFn: () => apiGet<TestAccount[]>("/api/test/accounts"),
    enabled,
    retry: false,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!enabled) return null;

  async function signIn(id: string) {
    setBusy(id);
    setError(null);
    try {
      props.onSignedIn(await apiPost<SessionInfo>("/api/test/sign-in", { userId: id }));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Test accounts" className="mb-6" style={{ display: "grid", gap: 8 }}>
      <p className="text-sm" style={{ margin: 0, color: "var(--ink-2)" }}>
        Test server — sign in as a test account. No password; demo data only.
      </p>
      {(accounts.data ?? []).map((a) => (
        <Button
          key={a.id}
          type="button"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => void signIn(a.id)}
          className="w-full"
        >
          {busy === a.id ? "Signing in…" : `${a.displayName} · ${a.role}`}
        </Button>
      ))}
      {accounts.isError && (
        <p role="alert" className="text-sm" style={{ margin: 0, color: "var(--warn)" }}>
          {accounts.error instanceof ApiClientError ? accounts.error.message : "Could not list test accounts."}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm" style={{ margin: 0, color: "var(--warn)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
