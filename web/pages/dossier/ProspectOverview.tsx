import { Link } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";
import type {
  DiligenceItemView,
  DiligenceStatus,
  ProjectView,
  PropertyCommentView,
  PropertyDossier,
} from "../../../shared/types";
import { summarizeDiligence } from "../../../shared/diligence-checklist";
import { formatCents, formatDate, formatRelativeTime } from "../../lib/format";
import { StatusPill } from "../../components/StatusPill";
import { hero } from "../../components/KeyGlyph";
import type { Severity } from "../../lib/status";

/**
 * Overview for a property you have not bought.
 *
 * The owned version leads with the doors and who is behind them, which on a
 * prospect is a list of empty rooms. What you actually want when you open one
 * is the state of the decision, and that lives in three other tabs — so this
 * is the briefing off the top of them: what the work costs, what the checks
 * came back saying, and what everyone thinks.
 *
 * It shows the ANSWERS, not the counts. The stat strip above already carries
 * the counts, and a second set of the same four numbers in bigger boxes would
 * be a dashboard about a dashboard. So: findings rather than "12 outstanding",
 * the actual likes and concerns rather than "5 / 3", each project's own gap
 * rather than one portfolio total.
 *
 * Every panel links to the tab it summarises and truncates rather than
 * scrolling. A summary you have to scroll is the page it summarises.
 */
export function ProspectOverview({ dossier }: { dossier: PropertyDossier }): ReactElement {
  const color = dossier.property.heroColor;

  return (
    <div style={{ display: "grid", gap: 22 }}>
      <div
        style={{
          display: "grid",
          gap: 22,
          gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))",
          alignItems: "start",
        }}
      >
        <RenovationPanel projects={dossier.projects} color={color} />
        <DiligencePanel items={dossier.diligence} />
      </div>
      <DiscussionPanel messages={dossier.discussion} />
    </div>
  );
}

/* ------------------------------------------------------------------ shell -- */

function Panel({
  title,
  to,
  linkLabel,
  footer,
  children,
}: {
  title: string;
  to: string;
  linkLabel: string;
  footer?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <section
      style={{
        background: "var(--panel-2)",
        border: "1px solid var(--line)",
        borderRadius: 16,
        padding: "16px 18px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <h2 className="kr-display" style={{ margin: 0, fontSize: 18 }}>
          {title}
        </h2>
        <Link to={to} className="kr-label" style={{ color: "var(--ink-3)", whiteSpace: "nowrap" }}>
          {linkLabel} →
        </Link>
      </div>
      {children}
      {footer && (
        <p
          className="kr-label"
          style={{ margin: "12px 0 0", paddingTop: 10, borderTop: "1px solid var(--line-soft)" }}
        >
          {footer}
        </p>
      )}
    </section>
  );
}

function Nothing({ children }: { children: ReactNode }): ReactElement {
  return <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)" }}>{children}</p>;
}

/** "and 3 more" rather than a scrollbar — see the header. */
function More({ n, to }: { n: number; to: string }): ReactElement | null {
  if (n <= 0) return null;
  return (
    <Link to={to} style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
      and {n} more
    </Link>
  );
}

/* ------------------------------------------------------------- renovation -- */

const SHOWN = 4;

function projectSeverity(s: ProjectView["status"]): Severity {
  if (s === "done") return "ok";
  if (s === "blocked") return "urgent";
  if (s === "in_progress" || s === "quoted" || s === "approved") return "warn";
  return "neutral";
}

function RenovationPanel({
  projects,
  color,
}: {
  projects: ProjectView[];
  color: string | null;
}): ReactElement {
  // Cancelled work is not part of what it costs to get this rentable.
  const live = projects.filter((p) => p.status !== "cancelled");
  const shown = live.slice(0, SHOWN);
  const budgeted = live.reduce((sum, p) => sum + p.budgetTotalCents, 0);
  const spent = live.reduce((sum, p) => sum + p.actualTotalCents, 0);

  return (
    <Panel
      title="Getting it rentable"
      to="../projects"
      linkLabel="Renovation"
      footer={
        live.length > 0
          ? `${formatCents(spent)} spent of ${formatCents(budgeted)} budgeted`
          : undefined
      }
    >
      {live.length === 0 ? (
        <Nothing>
          Nothing scoped yet. <Link to="../projects">Start with what stops it being rentable.</Link>
        </Nothing>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
          {shown.map((p) => (
            <li key={p.id}>
              <Link
                to={`../projects?project=${p.id}`}
                style={{ display: "block", color: "var(--ink)" }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 600, minWidth: 0 }}>{p.title}</span>
                  <StatusPill
                    severity={projectSeverity(p.status)}
                    label={p.status.replace("_", " ")}
                  />
                </span>
                <SpendBar
                  budget={p.budgetTotalCents}
                  spent={p.actualTotalCents}
                  color={color}
                />
              </Link>
            </li>
          ))}
          <li>
            <More n={live.length - shown.length} to="../projects" />
          </li>
        </ul>
      )}
    </Panel>
  );
}

/**
 * Spend against budget as one line.
 *
 * Over budget fills the whole bar in the critical colour rather than
 * overflowing it, and the number beside it says by how much — a bar that runs
 * past its track reads as a rendering bug, not as a warning.
 */
function SpendBar({
  budget,
  spent,
  color,
}: {
  budget: number;
  spent: number;
  color: string | null;
}): ReactElement {
  const over = budget > 0 && spent > budget;
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;

  return (
    <>
      <span
        aria-hidden="true"
        style={{
          display: "block",
          height: 4,
          margin: "7px 0 5px",
          borderRadius: 999,
          background: "var(--line)",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${over ? 100 : pct}%`,
            background: over ? "var(--crit)" : hero.solid(color),
          }}
        />
      </span>
      <span className="kr-tabular" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
        {budget === 0
          ? `${formatCents(spent)} spent · no budget set`
          : over
            ? `${formatCents(spent)} of ${formatCents(budget)} — over by ${formatCents(spent - budget)}`
            : `${formatCents(spent)} of ${formatCents(budget)}`}
      </span>
    </>
  );
}

/* -------------------------------------------------------------- diligence -- */

function diligenceSeverity(s: DiligenceStatus): Severity {
  if (s === "verified") return "ok";
  if (s === "blocked") return "urgent";
  if (s === "received") return "warn";
  return "neutral";
}

const STATUS_LABEL: Record<DiligenceStatus, string> = {
  todo: "Not asked",
  requested: "Asked",
  received: "Arrived",
  verified: "Checked",
  blocked: "Blocked",
  not_applicable: "N/A",
};

function isOverdue(item: DiligenceItemView, today: string): boolean {
  return (
    item.dueDate !== null &&
    item.dueDate < today &&
    item.status !== "verified" &&
    item.status !== "not_applicable"
  );
}

function DiligencePanel({ items }: { items: DiligenceItemView[] }): ReactElement {
  const today = new Date().toISOString().slice(0, 10);
  const summary = summarizeDiligence(items);

  /**
   * What was learned, worst first.
   *
   * A finding is the answer to a question somebody asked, which makes it the
   * only part of a checklist worth putting on a summary page — "12 items
   * outstanding" tells you nothing you cannot see in the stat strip. Blocked
   * ahead of arrived ahead of checked, because that is the order in which they
   * can still change your mind.
   */
  const rank: Record<DiligenceStatus, number> = {
    blocked: 0,
    received: 1,
    requested: 2,
    verified: 3,
    todo: 4,
    not_applicable: 5,
  };
  const findings = items
    .filter((i) => (i.finding ?? "").trim().length > 0)
    .sort((a, b) => rank[a.status] - rank[b.status]);
  const shown = findings.slice(0, SHOWN);

  // Chases that have a date on them and have not come back.
  const chasing = items
    .filter((i) => i.dueDate !== null && i.status !== "verified" && i.status !== "not_applicable")
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
    .slice(0, 3);

  return (
    <Panel
      title="What the checks say"
      to="../diligence"
      linkLabel="Diligence"
      footer={
        items.length > 0
          ? `${summary.outstanding} still open · ${summary.verified} checked${
              summary.blocked > 0 ? ` · ${summary.blocked} blocked` : ""
            }`
          : undefined
      }
    >
      {items.length === 0 ? (
        <Nothing>
          Nothing on the checklist. <Link to="../diligence">Start from the standard list.</Link>
        </Nothing>
      ) : findings.length === 0 ? (
        <Nothing>Nothing has come back yet.</Nothing>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
          {shown.map((item) => (
            <li key={item.id}>
              <Link
                to={`../diligence?item=${item.id}`}
                style={{ display: "block", color: "var(--ink)" }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 600, minWidth: 0 }}>{item.label}</span>
                  <StatusPill
                    severity={diligenceSeverity(item.status)}
                    label={STATUS_LABEL[item.status]}
                  />
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: 13,
                    color: "var(--ink-2)",
                    marginTop: 3,
                  }}
                >
                  {item.finding}
                </span>
              </Link>
            </li>
          ))}
          <li>
            <More n={findings.length - shown.length} to="../diligence" />
          </li>
        </ul>
      )}

      {chasing.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line-soft)" }}>
          <h3 className="kr-label" style={{ marginBottom: 8 }}>
            Waiting on
          </h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 5 }}>
            {chasing.map((item) => (
              <li
                key={item.id}
                style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}
              >
                <Link to={`../diligence?item=${item.id}`} style={{ color: "var(--ink-2)" }}>
                  {item.label}
                </Link>
                <span
                  className="kr-tabular"
                  style={{
                    flex: "none",
                    color: isOverdue(item, today) ? "var(--crit)" : "var(--ink-3)",
                    fontSize: 12.5,
                  }}
                >
                  {isOverdue(item, today) ? "overdue " : ""}
                  {formatDate(item.dueDate)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------- discussion -- */

function DiscussionPanel({ messages }: { messages: PropertyCommentView[] }): ReactElement {
  const likes = messages.filter((m) => m.sentiment === "like");
  const concerns = messages.filter((m) => m.sentiment === "dislike");
  const latest = messages[messages.length - 1];

  return (
    <Panel
      title="What we think"
      to="../discussion"
      linkLabel="Discussion"
      footer={
        latest
          ? `${latest.author?.displayName ?? "Someone"} · ${formatRelativeTime(latest.createdAt)}`
          : undefined
      }
    >
      {messages.length === 0 ? (
        <Nothing>
          Nothing said yet.{" "}
          <Link to="../discussion">First impressions are the ones you forget.</Link>
        </Nothing>
      ) : likes.length === 0 && concerns.length === 0 ? (
        <Nothing>
          {messages.length} {messages.length === 1 ? "message" : "messages"}, none of them marked a
          plus or a minus yet.
        </Nothing>
      ) : (
        <div
          style={{
            display: "grid",
            gap: 18,
            gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))",
          }}
        >
          <SentimentList title="Likes" tone="var(--ok)" items={likes} />
          <SentimentList title="Concerns" tone="var(--warn)" items={concerns} />
        </div>
      )}
    </Panel>
  );
}

function SentimentList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: string;
  items: PropertyCommentView[];
}): ReactElement {
  const shown = items.slice(0, SHOWN);
  return (
    <div style={{ borderLeft: `3px solid ${tone}`, paddingLeft: 12 }}>
      <h3 className="kr-label" style={{ marginBottom: 8 }}>
        {title} · {items.length}
      </h3>
      {items.length === 0 ? (
        <Nothing>None noted.</Nothing>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 7 }}>
          {shown.map((m) => (
            <li key={m.id} style={{ fontSize: 13, color: "var(--ink-2)" }}>
              <Link to={`../discussion?message=${m.id}`} style={{ color: "inherit" }}>
                {m.body}
              </Link>
            </li>
          ))}
          <li>
            <More n={items.length - shown.length} to="../discussion" />
          </li>
        </ul>
      )}
    </div>
  );
}
