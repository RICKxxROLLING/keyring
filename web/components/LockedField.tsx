import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EntityType, User } from "../../shared/types";
import { apiGet } from "../lib/api";
import { useFieldLock } from "../lib/realtime";
import { LockIcon } from "./icons";

const USERS_QUERY_KEY = ["users", "mentionable"] as const;

/** Finds an in-progress "@handle" token immediately before the caret, if any. */
function activeMentionToken(value: string, caret: number): { start: number; query: string } | null {
  const upToCaret = value.slice(0, caret);
  const match = /(?:^|\s)@([a-z0-9_-]*)$/i.exec(upToCaret);
  if (!match) return null;
  return { start: caret - match[1]!.length - 1, query: match[1]!.toLowerCase() };
}

/**
 * A textarea backed by a soft field lock (design §C8.6, §C10.5) with @mention autocomplete.
 * While another user holds the lock, this renders read-only and streams their live draft
 * instead of the saved value — the lock never blocks the underlying PATCH, only the UI.
 */
export function LockedTextArea(props: {
  entityType: EntityType;
  entityId: string;
  field: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  mentionable?: boolean;
}): JSX.Element {
  const lock = useFieldLock({ entityType: props.entityType, entityId: props.entityId, field: props.field });
  const denied = lock.status === "denied";
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | null>(null);

  useEffect(() => {
    return () => lock.release();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const usersQuery = useQuery({
    queryKey: USERS_QUERY_KEY,
    queryFn: () => apiGet<{ items: User[] }>("/api/users"),
    enabled: Boolean(props.mentionable) && mentionQuery !== null,
    staleTime: 5 * 60_000,
  });

  const suggestions = useMemo(() => {
    if (!mentionQuery || !usersQuery.data) return [];
    return usersQuery.data.items.filter((u) => u.handle.startsWith(mentionQuery.query)).slice(0, 5);
  }, [mentionQuery, usersQuery.data]);

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    props.onChange(next);
    lock.sendDraft(next);
    if (props.mentionable) {
      setMentionQuery(activeMentionToken(next, e.target.selectionStart ?? next.length));
    }
  }

  function insertMention(handle: string) {
    if (!mentionQuery) return;
    const before = props.value.slice(0, mentionQuery.start);
    const after = props.value.slice(mentionQuery.start + 1 + mentionQuery.query.length);
    const next = `${before}@${handle} ${after}`;
    props.onChange(next);
    lock.sendDraft(next);
    setMentionQuery(null);
    ref.current?.focus();
  }

  const displayValue = denied ? (lock.remoteDraft ?? props.value) : props.value;

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={displayValue}
        readOnly={denied}
        rows={props.rows ?? 4}
        placeholder={props.placeholder}
        onFocus={() => lock.acquire()}
        onBlur={() => {
          lock.release();
          setTimeout(() => setMentionQuery(null), 150);
        }}
        onChange={handleChange}
        className={`w-full rounded-lg border px-3 py-2.5 text-base focus:outline-none focus:ring-2 ${
          denied
            ? "border-amber-300 bg-amber-50 text-slate-600"
            : "border-slate-300 bg-white text-slate-900 focus:border-brand-500 focus:ring-brand-100"
        } ${props.className ?? ""}`}
      />
      {denied && lock.holder && (
        <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-amber-700">
          <LockIcon width={14} height={14} />
          {lock.holder.displayName} is editing…
        </p>
      )}
      {props.mentionable && mentionQuery && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg" role="listbox">
          {suggestions.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertMention(u.handle)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-semibold text-slate-800">@{u.handle}</span>
                <span className="text-slate-500">{u.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
