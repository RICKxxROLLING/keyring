import { useState, type FormEvent, type ReactElement } from "react";
import type { EnrollmentChallenge, RecoveryCodes, SessionInfo } from "../../shared/types";
import { ApiClientError } from "../lib/api";
import { Button } from "./Button";
import { ErrorNotice, Field, TextInput } from "./Form";
import { QrCode } from "./QrCode";
import { CheckIcon } from "./icons";

type Step = "qr" | "code" | "recovery";

/**
 * Shared second half of both first-run setup and invite acceptance (design §C6.6 auth flow):
 * show the TOTP QR + secret, verify a 6-digit code, then require an explicit acknowledgement
 * of the one-time recovery-code display before completing.
 */
export function EnrollmentFlow(props: {
  enrollment: EnrollmentChallenge;
  onVerify: (code: string) => Promise<{ session: SessionInfo; recovery: RecoveryCodes }>;
  onComplete: (session: SessionInfo) => void;
}): ReactElement {
  const [step, setStep] = useState<Step>("qr");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ session: SessionInfo; recovery: RecoveryCodes } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await props.onVerify(code);
      setResult(res);
      setStep("recovery");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "qr") {
    return (
      <div>
        <p className="mb-3 text-sm text-slate-600">
          Scan this with your authenticator app (1Password, Authy, Google Authenticator…), or enter the secret
          manually.
        </p>
        <div className="mb-3 flex justify-center">
          <QrCode text={props.enrollment.otpauthUrl} />
        </div>
        <Field label="Manual entry secret">
          <TextInput readOnly value={props.enrollment.secret} className="font-mono text-sm" />
        </Field>
        <Button className="mt-2 w-full" onClick={() => setStep("code")}>
          I've added this account
        </Button>
      </div>
    );
  }

  if (step === "code") {
    return (
      <form onSubmit={submitCode}>
        {error && (
          <div className="mb-3">
            <ErrorNotice message={error} />
          </div>
        )}
        <Field label="6-digit code" hint="From the app you just added Stoop to.">
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
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Verifying…" : "Verify"}
        </Button>
      </form>
    );
  }

  // step === "recovery"
  if (!result) return <ErrorNotice message="Something went wrong. Refresh and try again." />;
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-slate-800">Save these recovery codes now</p>
      <p className="mb-3 text-sm text-slate-600">
        Each code works once, and gets you in if you lose your authenticator. This is the only time Stoop will show
        them.
      </p>
      <div className="mb-3 grid grid-cols-2 gap-1.5 rounded-lg bg-slate-50 p-3 font-mono text-sm">
        {result.recovery.codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <label className="mb-3 flex items-start gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5"
        />
        I've saved these codes somewhere safe.
      </label>
      <Button className="flex w-full items-center justify-center gap-2" disabled={!acknowledged} onClick={() => props.onComplete(result.session)}>
        <CheckIcon width={16} height={16} />
        Done
      </Button>
    </div>
  );
}
