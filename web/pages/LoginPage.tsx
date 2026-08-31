import { useState, type FormEvent, type ReactElement } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { EnrollmentChallenge, RecoveryCodes, SessionInfo } from "../../shared/types";
import { apiPost, ApiClientError } from "../lib/api";
import { useSession } from "../lib/session";
import { Button } from "../components/Button";
import { EnrollmentFlow } from "../components/EnrollmentFlow";
import { ErrorNotice, Field, TextInput } from "../components/Form";
import { AuthLayout } from "../components/AuthLayout";

type Step = "password" | "totp" | "recovery" | "reenroll";

/** POST /api/auth/login returns an `enrollment` block instead of a plain MFA
 *  challenge when an owner has reset this user's TOTP: the secret has been
 *  regenerated but not yet confirmed, so they set up their authenticator again
 *  before they can sign in. */
interface LoginResponse {
  mfaToken: string;
  expiresAt: string;
  enrollment?: EnrollmentChallenge;
}

export function LoginPage(): ReactElement {
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [enrollment, setEnrollment] = useState<EnrollmentChallenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { setSession, needsSetup } = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? "/";

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiPost<LoginResponse>("/api/auth/login", { email, password });
      setMfaToken(res.mfaToken);
      if (res.enrollment) {
        setEnrollment(res.enrollment);
        setStep("reenroll");
      } else {
        setStep("totp");
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitTotp(e: FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setError(null);
    setBusy(true);
    try {
      const session = await apiPost<SessionInfo>("/api/auth/login/totp", { mfaToken, code });
      setSession(session);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitRecovery(e: FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setError(null);
    setBusy(true);
    try {
      const session = await apiPost<SessionInfo>("/api/auth/login/recovery", { mfaToken, recoveryCode });
      setSession(session);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Keyring"
      subtitle={
        step === "reenroll"
          ? "Set up your authenticator again to finish signing in."
          : "Sign in to manage your properties."
      }
      wide={step === "reenroll"}
      footer={
        // The setup screen is not linked from anywhere and the server is the
        // only thing that knows whether it is still available, so offer it
        // exactly when it applies rather than leaving a first-run user to
        // guess the URL.
        needsSetup ? (
          <>
            No account yet?{" "}
            <Link to="/setup" style={{ color: "var(--ink)", fontWeight: 600 }}>
              Complete first-time setup
            </Link>
          </>
        ) : null
      }
    >

        {error && (
          <div className="mb-3">
            <ErrorNotice message={error} />
          </div>
        )}

        {step === "reenroll" && enrollment && mfaToken && (
          <div>
            <p className="mb-4 text-sm" style={{ color: "var(--ink-2)" }}>
              An owner reset your two-factor authentication. Scan this code with your
              authenticator app to set it up again — your old entry for this account no longer
              works, so delete it. You will get a fresh set of recovery codes.
            </p>
            {/* Required alongside the authenticator code. The password already
                unlocked the new secret, so without this a stolen password alone
                would be enough to take the account during the reset window. */}
            <div className="mb-4">
              <Field
                label="One of your recovery codes"
                hint="Required to prove this account is yours. It will be used up."
              >
                <TextInput
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value)}
                  placeholder="xxxxx-xxxxx"
                />
              </Field>
            </div>
            <EnrollmentFlow
              enrollment={enrollment}
              onVerify={(verifyCode) =>
                apiPost<{ session: SessionInfo; recovery: RecoveryCodes }>(
                  "/api/auth/login/enroll",
                  // A recovery code is required as well as the authenticator
                  // code. Your password already unlocked the new secret, so
                  // this is the factor that proves the account is yours.
                  { mfaToken, code: verifyCode, recoveryCode },
                )
              }
              onComplete={(session) => {
                setSession(session);
                void navigate(from, { replace: true });
              }}
            />
          </div>
        )}

        {step === "password" && (
          <form onSubmit={submitPassword}>
            <Field label="Email">
              <TextInput type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            </Field>
            <Field label="Password">
              <TextInput
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <Button type="submit" disabled={busy} className="mt-2 w-full">
              {busy ? "Signing in…" : "Continue"}
            </Button>
          </form>
        )}

        {step === "totp" && (
          <form onSubmit={submitTotp}>
            <Field label="6-digit code" hint="From your authenticator app.">
              <TextInput
                required
                autoFocus
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={busy} className="mt-2 w-full">
              {busy ? "Verifying…" : "Verify"}
            </Button>
            <button
              type="button"
              onClick={() => setStep("recovery")}
              className="tap-target kr-rail-link mt-2 w-full text-center text-sm font-medium" style={{ color: "var(--ink-3)" }}
            >
              Use a recovery code instead
            </button>
          </form>
        )}

        {step === "recovery" && (
          <form onSubmit={submitRecovery}>
            <Field label="Recovery code" hint="One of your ten single-use codes, format xxxxx-xxxxx.">
              <TextInput required autoFocus value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} />
            </Field>
            <Button type="submit" disabled={busy} className="mt-2 w-full">
              {busy ? "Verifying…" : "Verify"}
            </Button>
            <button
              type="button"
              onClick={() => setStep("totp")}
              className="tap-target kr-rail-link mt-2 w-full text-center text-sm font-medium" style={{ color: "var(--ink-3)" }}
            >
              Back to authenticator code
            </button>
          </form>
        )}
    </AuthLayout>
  );
}
