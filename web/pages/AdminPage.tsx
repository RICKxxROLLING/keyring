import { useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuditEntry, BackupRun, Invite, OpsInfo, Page, Role, User } from "../../shared/types";
import { apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import { formatDateTime, formatRelativeTime } from "../lib/format";
import { useSession } from "../lib/session";
import { Button } from "../components/Button";
import { EmptyState, Field, Select, Spinner, TextInput } from "../components/Form";

type AdminTab = "users" | "invites" | "audit" | "backups";

export function AdminPage(): ReactElement {
  const [tab, setTab] = useState<AdminTab>("users");
  const tabs: { id: AdminTab; label: string }[] = [
    { id: "users", label: "Users" },
    { id: "invites", label: "Invites" },
    { id: "audit", label: "Audit log" },
    { id: "backups", label: "Backups" },
  ];

  return (
    <div>
      <h1 className="mb-4 text-xl font-black text-slate-900">Admin</h1>
      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`tap-target whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${
              tab === t.id ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "users" && <UsersPanel />}
      {tab === "invites" && <InvitesPanel />}
      {tab === "audit" && <AuditPanel />}
      {tab === "backups" && <BackupsPanel />}
    </div>
  );
}

function UsersPanel(): ReactElement {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ["admin", "users"], queryFn: () => apiGet<Page<User>>("/api/users?includeInactive=true") });

  const setRole = useMutation({
    mutationFn: (vars: { id: string; role: Role; version: number }) => apiPatch<User>(`/api/users/${vars.id}`, { role: vars.role, expectedVersion: vars.version }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  const toggleActive = useMutation({
    mutationFn: (vars: { id: string; isActive: boolean; version: number }) =>
      apiPatch<User>(`/api/users/${vars.id}`, { isActive: vars.isActive, expectedVersion: vars.version }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  const resetTotp = useMutation({
    mutationFn: (id: string) => apiPost(`/api/users/${id}/totp/reset`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  if (users.isPending) return <Spinner />;

  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
      {users.data?.items.map((u) => (
        <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="font-semibold text-slate-900">
              {u.displayName} <span className="font-normal text-slate-400">@{u.handle}</span>
            </p>
            <p className="text-sm text-slate-500">
              {u.email} · {u.isActive ? "Active" : "Deactivated"} · {u.totpEnrolled ? "TOTP enrolled" : "TOTP not set up"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={u.role}
              disabled={u.id === session?.user.id}
              onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value as Role, version: u.version })}
              className="w-auto py-1.5"
            >
              <option value="owner">owner</option>
              <option value="manager">manager</option>
            </Select>
            <Button
              variant="secondary"
              disabled={u.id === session?.user.id}
              onClick={() => {
                // Destructive and immediate: it signs the user out everywhere,
                // invalidates their authenticator entry, and voids their unused
                // recovery codes. Worth a confirm.
                const okToReset = window.confirm(
                  `Reset two-factor authentication for ${u.displayName}?\n\n` +
                    `They will be signed out of every device, their current authenticator ` +
                    `entry will stop working, and their unused recovery codes will be voided.\n\n` +
                    `They re-enroll themselves with their password at next sign-in.`,
                );
                if (okToReset) resetTotp.mutate(u.id);
              }}
            >
              Reset TOTP
            </Button>
            <Button
              variant={u.isActive ? "danger" : "secondary"}
              disabled={u.id === session?.user.id}
              onClick={() => toggleActive.mutate({ id: u.id, isActive: !u.isActive, version: u.version })}
            >
              {u.isActive ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function InvitesPanel(): ReactElement {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("manager");
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const invites = useQuery({ queryKey: ["admin", "invites"], queryFn: () => apiGet<Page<Invite>>("/api/invites?state=all") });

  const create = useMutation({
    mutationFn: () => apiPost<Invite>("/api/invites", { email, role }),
    onSuccess: (inv) => {
      setEmail("");
      setLastInviteUrl(inv.inviteUrl ?? null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "invites"] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/invites/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin", "invites"] }),
  });

  return (
    <div>
      <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-3">
        <Field label="Email">
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="manager">manager</option>
            <option value="owner">owner</option>
          </Select>
        </Field>
        <Button onClick={() => create.mutate()} disabled={!email.trim() || create.isPending} className="self-end">
          {create.isPending ? "Sending…" : "Send invite"}
        </Button>
      </div>

      {lastInviteUrl && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Invite link (shown once): <code className="break-all">{lastInviteUrl}</code>
        </div>
      )}

      {invites.data && invites.data.items.length === 0 && <EmptyState title="No invites yet" />}
      {invites.data && invites.data.items.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {invites.data.items.map((inv) => (
            <li key={inv.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-semibold text-slate-900">{inv.email}</p>
                <p className="text-sm text-slate-500">
                  {inv.role} · {inv.acceptedAt ? "Accepted" : inv.revokedAt ? "Revoked" : `Expires ${formatRelativeTime(inv.expiresAt)}`}
                </p>
              </div>
              {!inv.acceptedAt && !inv.revokedAt && (
                <Button variant="danger" onClick={() => revoke.mutate(inv.id)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AuditPanel(): ReactElement {
  const [actionFilter, setActionFilter] = useState("");
  const audit = useQuery({
    queryKey: ["admin", "audit", actionFilter],
    queryFn: () => apiGet<Page<AuditEntry>>(`/api/audit${actionFilter ? `?action=${actionFilter}` : ""}`),
  });

  return (
    <div>
      <div className="mb-3">
        <Field label="Filter by action">
          <Select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="">All actions</option>
            <option value="create">create</option>
            <option value="update">update</option>
            <option value="delete">delete</option>
            <option value="login">login</option>
            <option value="login_failed">login_failed</option>
          </Select>
        </Field>
      </div>
      {audit.isPending && <Spinner />}
      {audit.data && audit.data.items.length === 0 && <EmptyState title="No audit entries" />}
      {audit.data && audit.data.items.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {audit.data.items.map((entry) => (
            <li key={entry.id} className="px-4 py-3">
              <p className="text-sm text-slate-800">
                <span className="font-semibold">{entry.actorLabel}</span> {entry.summary}
              </p>
              <p className="text-xs text-slate-400">{formatDateTime(entry.at, "UTC")}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BackupsPanel(): ReactElement {
  const queryClient = useQueryClient();
  const info = useQuery({ queryKey: ["admin", "ops-info"], queryFn: () => apiGet<OpsInfo>("/api/ops/info") });
  const backups = useQuery({ queryKey: ["admin", "backups"], queryFn: () => apiGet<Page<BackupRun>>("/api/ops/backups") });

  const runBackup = useMutation({
    mutationFn: () => apiPost<BackupRun>("/api/ops/backups"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "backups"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "ops-info"] });
    },
  });

  return (
    <div>
      {info.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-4">
          <Stat label="DB size" value={`${(info.data.dbSizeBytes / 1_000_000).toFixed(1)} MB`} />
          <Stat label="Uploads" value={`${info.data.uploadCount}`} />
          <Stat label="Scheduled backup" value={info.data.scheduledBackupAt} />
          <Stat label="Retention" value={`${info.data.retentionDays}d`} />
        </div>
      )}

      <Button onClick={() => runBackup.mutate()} disabled={runBackup.isPending} className="mb-4">
        {runBackup.isPending ? "Starting…" : "Run backup now"}
      </Button>

      {backups.data && backups.data.items.length === 0 && <EmptyState title="No backups yet" />}
      {backups.data && backups.data.items.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {backups.data.items.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-semibold text-slate-900">{b.archiveName ?? b.kind}</p>
                <p className="text-sm text-slate-500">{b.status} · {formatRelativeTime(b.startedAt)}</p>
              </div>
              {b.sizeBytes && <span className="text-sm text-slate-500">{(b.sizeBytes / 1_000_000).toFixed(1)} MB</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat(props: { label: string; value: string }): ReactElement {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{props.label}</p>
      <p className="font-bold text-slate-900">{props.value}</p>
    </div>
  );
}
