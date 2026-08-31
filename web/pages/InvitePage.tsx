import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { AuthLayout } from "../components/AuthLayout";
import { useNavigate, useParams } from "react-router-dom";
import type { EnrollmentChallenge, RecoveryCodes, SessionInfo } from "../../shared/types";
import { apiGet, apiPost, ApiClientError } from "../lib/api";
import { useSession } from "../lib/session";
import { Button } from "../components/Button";
import { EnrollmentFlow } from "../components/EnrollmentFlow";
import { ErrorNotice, Field, Spinner, TextInput } from "../components/Form";

interface InvitePreview {
  email: string;
  role: "owner" | "manager";
  valid: boolean;
  expiresAt: string;
}

export function InvitePage(): ReactElement {
  const { token } = useParams<{ token: string }>();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState<{ mfaToken: string; enrollment: EnrollmentChallenge } | null>(null);
  const { setSession } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) return;
    apiGet<InvitePreview>(`/api/invites/${token}/preview`)
      .then(setPreview)
      .catch(() => setLoadError(true));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setBusy(true);
    try {
      const res = await apiPost<{ userId: string; mfaToken: string; enrollment: EnrollmentChallenge }>(
        `/api/invites/${token}/accept`,
        { handle, displayName, password },
      );
      setAccepted({ mfaToken: res.mfaToken, enrollment: res.enrollment });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      wide
      title="You have been handed a key"
      subtitle="Pick a password and set up your authenticator. Only the person who invited you can create this account."
    >

        {loadError && <ErrorNotice message="This invite link is invalid, expired, or already used." />}
        {!preview && !loadError && <Spinner label="Checking invite…" />}

        {preview && !accepted && (
          <>
            <p className="mb-5 text-sm text-slate-500">
              Invited as <strong>{preview.email}</strong> ({preview.role}).
            </p>
            {error && (
              <div className="mb-3">
                <ErrorNotice message={error} />
              </div>
            )}
            <form onSubmit={submit}>
              <Field label="Handle" hint="Lowercase, used for @mentions.">
                <TextInput required autoFocus value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} />
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
          </>
        )}

        {accepted && (
          <EnrollmentFlow
            enrollment={accepted.enrollment}
            onVerify={(code) => apiPost<{ session: SessionInfo; recovery: RecoveryCodes }>("/api/invites/accept/verify", { mfaToken: accepted.mfaToken, code })}
            onComplete={(session) => {
              setSession(session);
              navigate("/", { replace: true });
            }}
          />
        )}
    </AuthLayout>
  );
}
