import { useQuery } from "@tanstack/react-query";
import { useMemo, type ReactElement } from "react";
import type { AuditEntry, Upload, WorkOrderCommentView } from "../../shared/types";
import { apiGet } from "../lib/api";
import { formatRelativeTime } from "../lib/format";
import { AttachmentList } from "./AttachmentList";
import { hero } from "./KeyGlyph";

/**
 * What has actually happened to this work order, in order.
 *
 * From the tracking list: "Work orders should show an active timeline when they
 * are open showing all edits to them and attached photos or comments /
 * progress until they are closed out."
 *
 * Three sources merged into one strand, because they are one story:
 *   - the audit log for this entity (every field change, with who and when)
 *   - comments
 *   - photos attached to it
 *
 * The audit log is the interesting half — it already recorded every edit and
 * nothing ever showed it, so "who moved this to scheduled, and when?" was
 * answerable only by reading the database.
 */
export function WorkOrderTimeline(props: {
  workOrderId: string;
  color: string | null;
  attachments: Upload[];
  comments: WorkOrderCommentView[];
}): ReactElement {
  const audit = useQuery({
    queryKey: ["audit", "work_order", props.workOrderId],
    queryFn: () =>
      apiGet<{ items: AuditEntry[] }>(
        `/api/audit?entityType=work_order&entityId=${encodeURIComponent(props.workOrderId)}&limit=100`,
      ),
  });

  const events = useMemo(() => {
    const out: TimelineEvent[] = [];

    for (const a of audit.data?.items ?? []) {
      out.push({
        id: `audit-${a.id}`,
        at: a.at,
        actor: a.actorLabel,
        kind: a.action === "create" ? "opened" : "changed",
        text: a.summary,
        changes: describeChanges(a),
      });
    }
    for (const c of props.comments) {
      out.push({
        id: `comment-${c.id}`,
        at: c.createdAt,
        actor: c.author?.displayName ?? "Someone",
        kind: "comment",
        text: c.body,
      });
    }
    for (const u of props.attachments) {
      out.push({
        id: `file-${u.id}`,
        at: u.createdAt,
        actor: null,
        kind: "file",
        text: u.filename,
        upload: u,
      });
    }

    // Newest last: this reads as a story of the job, and the most recent thing
    // sits next to the box where you add the next one.
    return out.sort((a, b) => a.at.localeCompare(b.at));
  }, [audit.data, props.comments, props.attachments]);

  if (events.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "10px 0 0" }}>
        Nothing has happened yet.
      </p>
    );
  }

  return (
    <ol style={{ listStyle: "none", margin: "12px 0 0", padding: 0, position: "relative" }}>
      {/* The spine. Decorative — the ordering is conveyed by the list itself. */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 5,
          top: 6,
          bottom: 6,
          width: 2,
          background: "var(--line)",
        }}
      />
      {events.map((e) => (
        <li key={e.id} style={{ position: "relative", padding: "0 0 14px 22px" }}>
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              top: 5,
              width: 12,
              height: 12,
              borderRadius: 999,
              background: e.kind === "comment" ? hero.solid(props.color) : "var(--panel)",
              border: `2px solid ${e.kind === "comment" ? hero.solid(props.color) : "var(--line)"}`,
            }}
          />
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: e.kind === "comment" ? 600 : 500 }}>
              {e.actor ?? "System"}
            </span>
            <span className="kr-label" style={{ fontSize: 9 }}>
              {formatRelativeTime(e.at)}
            </span>
          </div>
          <p style={{ margin: "2px 0 0", fontSize: 13.5, color: "var(--ink-2)" }}>{e.text}</p>
          {e.changes && e.changes.length > 0 && (
            <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "grid", gap: 2 }}>
              {e.changes.map((c) => (
                <li key={c} className="kr-label" style={{ fontSize: 9.5, letterSpacing: "0.08em" }}>
                  {c}
                </li>
              ))}
            </ul>
          )}
          {e.upload && <AttachmentList uploads={[e.upload]} />}
        </li>
      ))}
    </ol>
  );
}

interface TimelineEvent {
  id: string;
  at: string;
  actor: string | null;
  kind: "opened" | "changed" | "comment" | "file";
  text: string;
  changes?: string[];
  upload?: Upload;
}

/**
 * Turn an audit row's before/after into readable lines.
 *
 * Only fields that actually differ, and only ones worth reading — the audit
 * payload carries the whole row, so printing all of it would bury the one
 * field that changed under twenty that did not.
 */
function describeChanges(a: AuditEntry): string[] {
  const before = (a.before ?? {}) as Record<string, unknown>;
  const after = (a.after ?? {}) as Record<string, unknown>;
  const interesting = ["status", "priority", "assigneeId", "dueDate", "vendorId", "costCents", "title"];
  const out: string[] = [];
  for (const key of interesting) {
    if (!(key in after)) continue;
    const b = before[key];
    const v = after[key];
    if (b === v) continue;
    out.push(`${humanize(key)}: ${format(b)} → ${format(v)}`);
  }
  return out;
}

function humanize(key: string): string {
  return key
    .replace(/Id$/, "")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function format(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}
