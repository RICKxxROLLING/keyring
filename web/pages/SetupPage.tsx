import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { EnrollmentChallenge, RecoveryCodes, SessionInfo } from "../../shared/types";
import { apiPost, ApiClientError } from "../lib/api";
import { useSession } from "../lib/session";
import { Button } from "../components/Button";
import { EnrollmentFlow } from "../components/EnrollmentFlow";
import { ErrorNotice, Field, TextInput } from "../components/Form";

export function SetupPage(): JSX.Element {
  const [setupToken, setSetupToken] = useState("");
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bootstrapped, setBootstrapped] = useState<{ mfaToken: string; enrollment: EnrollmentChallenge } | null>(null);
  const { setSession } = useSession();
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiPost<{ userId: string; mfaToken: string; enrollment: EnrollmentChallenge }>(
        "/api/setup/bootstrap",
        { setupToken, email, handle, displayName, password },
      );
      setBootstrapped({ mfaToken: res.mfaToken, enrollment: res.enrollment });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-2xl font-black text-slate-900">Set up Stoop</h1>
        <p className="mb-5 text-sm text-slate-500">
          Create the first owner account. You'll need the setup token from the server console or{" "}
          <code className="rounded bg-slate-100 px-1">setup-token.txt</code>.
        </p>

        {error && (
          <div className="mb-3">
            <ErrorNotice message={error} />
          </div>
        )}

        {!bootstrapped ? (
          <form onSubmit={submit}>
            <Field label="Setup token">
              <TextInput required autoFocus value={setupToken} onChange={(e) => setSetupToken(e.target.value)} />
            </Field>
            <Field label="Email">
              <TextInput type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Handle" hint="Lowercase, used for @mentions.">
              <TextInput required value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} />
            </Field>
            <Field label="Display name">
              <TextInput required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </Field>
            <Field label="Password">
              <TextInput type="password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Button type="submit" disabled={busy} className="mt-2 w-full">
              {busy ? "Creating account…" : "Continue"}
            </Button>
          </form>
        ) : (
          <EnrollmentFlow
            enrollment={bootstrapped.enrollment}
            onVerify={(code) => apiPost<{ session: SessionInfo; recovery: RecoveryCodes }>("/api/setup/bootstrap/verify", { mfaToken: bootstrapped.mfaToken, code })}
            onComplete={(session) => {
              setSession(session);
              navigate("/", { replace: true });
            }}
          />
        )}
      </div>
    </div>
  );
}
