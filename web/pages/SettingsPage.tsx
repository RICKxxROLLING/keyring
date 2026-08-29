import { useState, type FormEvent } from "react";
import type { RecoveryCodes, SessionInfo, User } from "../../shared/types";
import { apiPatch, apiPost, ApiClientError } from "../lib/api";
import { useSession } from "../lib/session";
import { Button } from "../components/Button";
import { ErrorNotice, Field, TextInput } from "../components/Form";

const AVATAR_COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];

export function SettingsPage(): JSX.Element {
  const { session, setSession } = useSession();
  if (!session) return <></>;
  return <SettingsForm session={session} setSession={setSession} />;
}

function SettingsForm(props: { session: SessionInfo; setSession: (s: SessionInfo) => void }): JSX.Element {
  const { session, setSession } = props;
  const [displayName, setDisplayName] = useState(session.user.displayName);
  const [avatarColor, setAvatarColor] = useState(session.user.avatarColor);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);
  const [passwordErr, setPasswordErr] = useState<string | null>(null);

  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [recoveryErr, setRecoveryErr] = useState<string | null>(null);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setProfileMsg(null);
    try {
      const updated = await apiPatch<User>("/api/users/me", { displayName, avatarColor, expectedVersion: session.user.version });
      setSession({ ...session, user: updated });
      setProfileMsg("Saved.");
    } catch (err) {
      setProfileMsg(err instanceof ApiClientError ? err.message : "Couldn't save.");
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordErr(null);
    setPasswordMsg(null);
    try {
      await apiPost("/api/auth/password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setPasswordMsg("Password updated.");
    } catch (err) {
      setPasswordErr(err instanceof ApiClientError ? err.message : "Couldn't change password.");
    }
  }

  async function regenerateRecovery(e: FormEvent) {
    e.preventDefault();
    setRecoveryErr(null);
    try {
      const res = await apiPost<RecoveryCodes>("/api/auth/recovery-codes/regenerate", { password: recoveryPassword, code: recoveryCode });
      setNewCodes(res.codes);
      setRecoveryPassword("");
      setRecoveryCode("");
    } catch (err) {
      setRecoveryErr(err instanceof ApiClientError ? err.message : "Couldn't regenerate codes.");
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-4 text-xl font-black text-slate-900">Settings</h1>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-bold text-slate-900">Profile</h2>
        <form onSubmit={saveProfile}>
          <Field label="Display name">
            <TextInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          <p className="mb-1 text-sm font-medium text-slate-700">Avatar colour</p>
          <div className="mb-3 flex gap-2">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setAvatarColor(c)}
                aria-label={`Choose ${c}`}
                className={`h-9 w-9 rounded-full ${avatarColor === c ? "ring-2 ring-offset-2 ring-slate-900" : ""}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          {profileMsg && <p className="mb-2 text-sm text-slate-600">{profileMsg}</p>}
          <Button type="submit">Save profile</Button>
        </form>
      </section>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-bold text-slate-900">Change password</h2>
        {passwordErr && (
          <div className="mb-2">
            <ErrorNotice message={passwordErr} />
          </div>
        )}
        {passwordMsg && <p className="mb-2 text-sm text-emerald-700">{passwordMsg}</p>}
        <form onSubmit={changePassword}>
          <Field label="Current password">
            <TextInput type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </Field>
          <Field label="New password">
            <TextInput type="password" required minLength={12} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </Field>
          <Button type="submit">Update password</Button>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-bold text-slate-900">Recovery codes</h2>
        <p className="mb-3 text-sm text-slate-500">
          Regenerating invalidates your old codes. Requires your password and a current 6-digit code.
        </p>
        {recoveryErr && (
          <div className="mb-2">
            <ErrorNotice message={recoveryErr} />
          </div>
        )}
        {newCodes ? (
          <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-50 p-3 font-mono text-sm">
            {newCodes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        ) : (
          <form onSubmit={regenerateRecovery}>
            <Field label="Password">
              <TextInput type="password" required value={recoveryPassword} onChange={(e) => setRecoveryPassword(e.target.value)} />
            </Field>
            <Field label="6-digit code">
              <TextInput required inputMode="numeric" maxLength={6} value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} />
            </Field>
            <Button type="submit">Regenerate codes</Button>
          </form>
        )}
      </section>
    </div>
  );
}
