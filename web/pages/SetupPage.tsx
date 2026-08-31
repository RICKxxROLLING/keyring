import { useState, type FormEvent, type ReactElement } from "react";
import { AuthLayout } from "../components/AuthLayout";
import { useNavigate } from "react-router-dom";
import type { EnrollmentChallenge, RecoveryCodes, SessionInfo } from "../../shared/types";
import { apiPost, ApiClientError } from "../lib/api";
import { useSession } from "../lib/session";
import { Button } from "../components/Button";
import { EnrollmentFlow } from "../components/EnrollmentFlow";
import { ErrorNotice, Field, TextInput } from "../components/Form";

export function SetupPage(): ReactElement {
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
    <AuthLayout
      wide
      title="Cut the first key"
      subtitle="Create the owner account. You will need the setup token — it is printed once in the server log and written to setup-token.txt in your data directory."
    >

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
    </AuthLayout>
  );
}
