import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type { CommentSentiment, PropertyCommentView } from "../../../shared/types";
import { apiDelete, apiPatch, apiPost } from "../../lib/api";
import { qk } from "../../lib/query";
import { useDossier } from "../../lib/dossier-context";
import { useOptionalSession } from "../../lib/session";
import { formatRelativeTime } from "../../lib/format";
import { Avatar } from "../../components/Avatar";
import { Button } from "../../components/Button";
import { EmptyState, TextArea } from "../../components/Form";
import { hero } from "../../components/KeyGlyph";
import { pulseProps, useChangePulse } from "../../lib/change-pulse";

/**
 * What everyone thinks of the place.
 *
 * A buy is a conversation, and the list of likes and dislikes that comes out of
 * two or three people walking the same house is the actual artefact of
 * deciding. Notes could not hold it: a note is a document with a title that one
 * person owns and edits, and the whole point here is a running exchange.
 *
 * WHY THE PLUS AND MINUS. Tagging a message costs one click and turns a
 * scroll-back into a pros-and-cons list you can read at a glance, which is the
 * exact question being asked of a prospect. Most messages are neither, so an
 * untagged message is the default and looks like an ordinary one.
 *
 * The summary at the top is built from the thread rather than kept separately.
 * A pros-and-cons list maintained apart from the conversation goes stale the
 * first time someone changes their mind in a reply.
 */
export function DiscussionTab(): ReactElement {
  const dossier = useDossier();
  // Optional: a tab rendered in a test has no SessionProvider, and losing the
  // whole thread over a missing "can I edit this" answer is the wrong trade.
  const me = useOptionalSession()?.session?.user ?? null;
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [body, setBody] = useState("");
  const [sentiment, setSentiment] = useState<CommentSentiment | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const messages = dossier.discussion;
  const highlighted = params.get("message");

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: qk.dossier(dossier.property.id) });
  }

  const post = useMutation({
    mutationFn: () =>
      apiPost<PropertyCommentView>(`/api/properties/${dossier.property.id}/discussion`, {
        body,
        sentiment,
      }),
    onSuccess: () => {
      setBody("");
      setSentiment(null);
      invalidate();
    },
  });

  // Jump to the newest message on arrival, the way you would open a thread.
  // Not when a specific message is deep-linked — that one is the destination.
  // Optional-called because jsdom has no scrollIntoView, and a thread that
  // fails to render because it could not scroll is a poor trade.
  useEffect(() => {
    if (!highlighted) endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [highlighted, messages.length]);

  const { likes, concerns } = useMemo(
    () => ({
      likes: messages.filter((m) => m.sentiment === "like"),
      concerns: messages.filter((m) => m.sentiment === "dislike"),
    }),
    [messages],
  );

  const color = dossier.property.heroColor;

  return (
    <div>
      <h2 className="kr-display kr-h-section" style={{ margin: 0, fontSize: 20 }}>
        What we think
      </h2>
      <p style={{ margin: "6px 0 18px", fontSize: 13, color: "var(--ink-2)", maxWidth: "62ch" }}>
        {dossier.property.stage === "prospect"
          ? "Everything anyone noticed about this house. Mark a message as a plus or a minus and it joins the summary."
          : "The running conversation about this property."}
      </p>

      {(likes.length > 0 || concerns.length > 0) && (
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))",
            marginBottom: 22,
          }}
        >
          <SentimentPanel title="Likes" tone="var(--ok)" items={likes} />
          <SentimentPanel title="Concerns" tone="var(--warn)" items={concerns} />
        </div>
      )}

      {messages.length === 0 ? (
        <EmptyState
          title="Nothing said yet"
          detail="First impressions are the ones you forget. Write them down before the second viewing."
        />
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
          {messages.map((m) => (
            <li key={m.id}>
              <Message
                message={m}
                color={color}
                highlighted={m.id === highlighted}
                canEdit={m.createdBy === me?.id}
                canDelete={m.createdBy === me?.id || me?.role === "owner"}
                onChanged={invalidate}
              />
            </li>
          ))}
        </ol>
      )}
      <div ref={endRef} />

      {/* The composer sits at the bottom, where a thread's composer belongs. */}
      <div
        style={{
          marginTop: 20,
          padding: 14,
          borderRadius: 14,
          border: "1px solid var(--line)",
          background: "var(--panel)",
        }}
      >
        <TextArea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What did you notice?"
          aria-label="New message"
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            marginTop: 10,
          }}
        >
          <SentimentToggle value={sentiment} onChange={setSentiment} />
          <Button
            className="ml-auto"
            onClick={() => post.mutate()}
            disabled={!body.trim() || post.isPending}
          >
            {post.isPending ? "Posting…" : "Post"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SentimentPanel({
  title,
  tone,
  items,
}: {
  title: string;
  tone: string;
  items: PropertyCommentView[];
}): ReactElement {
  return (
    <section
      style={{
        padding: "14px 16px",
        borderRadius: 14,
        border: "1px solid var(--line)",
        borderLeft: `4px solid ${tone}`,
        background: "var(--panel)",
      }}
    >
      <span className="kr-label" style={{ fontSize: 9.5 }}>
        {title} · {items.length}
      </span>
      {items.length === 0 ? (
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-3)" }}>None noted.</p>
      ) : (
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
          {items.map((m) => (
            <li key={m.id} style={{ fontSize: 13, color: "var(--ink-2)" }}>
              {m.body}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Message({
  message,
  color,
  highlighted,
  canEdit,
  canDelete,
  onChanged,
}: {
  message: PropertyCommentView;
  color: string | null;
  highlighted: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  // Someone else editing a message you are reading is exactly the case this
  // exists for — the words change under you and nothing else says so.
  const wash = pulseProps(useChangePulse("property_comment", message.id));

  const save = useMutation({
    mutationFn: () =>
      apiPatch<PropertyCommentView>(`/api/property-comments/${message.id}`, {
        body: draft,
        expectedVersion: message.version,
      }),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
  });

  const setSentiment = useMutation({
    mutationFn: (sentiment: CommentSentiment | null) =>
      apiPatch<PropertyCommentView>(`/api/property-comments/${message.id}`, {
        sentiment,
        expectedVersion: message.version,
      }),
    onSuccess: onChanged,
  });

  const remove = useMutation({
    mutationFn: () => apiDelete(`/api/property-comments/${message.id}`),
    onSuccess: onChanged,
  });

  const edge =
    message.sentiment === "like"
      ? "var(--ok)"
      : message.sentiment === "dislike"
        ? "var(--warn)"
        : "var(--line)";

  return (
    <article
      className={wash.className}
      style={
        {
          display: "flex",
          gap: 12,
          padding: "12px 14px",
          borderRadius: 14,
          border: "1px solid var(--line)",
          borderLeft: `4px solid ${edge}`,
          background: highlighted ? hero.tint(color, 10) : "var(--panel)",
          ...wash.style,
        } as CSSProperties
      }
    >
      {message.author && <Avatar user={message.author} size={30} />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-3)" }}>
          <span style={{ color: "var(--ink-2)", fontWeight: 600 }}>
            {message.author?.displayName ?? "Someone"}
          </span>{" "}
          · {formatRelativeTime(message.createdAt)}
          {/* Only when it really was edited — see PropertyCommentView.edited. */}
          {message.edited ? " · edited" : ""}
        </p>

        {editing ? (
          <div style={{ marginTop: 8 }}>
            <TextArea
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Edit message"
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Button onClick={() => save.mutate()} disabled={!draft.trim() || save.isPending}>
                Save
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setDraft(message.body);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p style={{ margin: "6px 0 0", fontSize: 14, whiteSpace: "pre-wrap" }}>{message.body}</p>
        )}

        {canEdit && !editing && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            <SentimentToggle
              value={message.sentiment}
              onChange={(s) => setSentiment.mutate(s)}
              small
            />
            <button type="button" className="kr-quiet-action" onClick={() => setEditing(true)}>
              Edit
            </button>
            {canDelete && (
              <button
                type="button"
                className="kr-quiet-action"
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
              >
                Delete
              </button>
            )}
          </div>
        )}
        {/* An owner tidying up someone else's message can delete it but not
            rewrite it, so this is the only control they get. */}
        {!canEdit && canDelete && (
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              className="kr-quiet-action"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function SentimentToggle({
  value,
  onChange,
  small,
}: {
  value: CommentSentiment | null;
  onChange: (value: CommentSentiment | null) => void;
  small?: boolean;
}): ReactElement {
  const options: { key: CommentSentiment; label: string; tone: string }[] = [
    { key: "like", label: "+ Like", tone: "var(--ok)" },
    { key: "dislike", label: "− Concern", tone: "var(--warn)" },
  ];
  return (
    <span role="group" aria-label="Mark as a like or a concern" style={{ display: "flex", gap: 6 }}>
      {options.map((o) => {
        const on = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            // Clicking the active one clears it: a mis-tagged message needs a
            // way back to plain, and a third "neutral" button would be a
            // control nobody presses on purpose.
            onClick={() => onChange(on ? null : o.key)}
            style={{
              padding: small ? "3px 9px" : "5px 12px",
              borderRadius: 999,
              fontSize: small ? 11.5 : 12.5,
              fontWeight: 600,
              cursor: "pointer",
              border: `1px solid ${on ? o.tone : "var(--line)"}`,
              background: on ? o.tone : "transparent",
              color: on ? "var(--panel)" : "var(--ink-3)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </span>
  );
}
