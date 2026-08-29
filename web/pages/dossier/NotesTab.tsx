import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { NoteView } from "../../../shared/types";
import { apiDelete, apiPatch, apiPost, ApiClientError } from "../../lib/api";
import { qk } from "../../lib/query";
import { useDossier } from "../../lib/dossier-context";
import { formatRelativeTime } from "../../lib/format";
import { Button, IconButton } from "../../components/Button";
import { EmptyState, Field, TextArea } from "../../components/Form";
import { LockedTextArea } from "../../components/LockedField";
import { VersionConflictDialog } from "../../components/VersionConflictDialog";
import { TrashIcon } from "../../components/icons";

export function NotesTab(): JSX.Element {
  const dossier = useDossier();
  const [newBody, setNewBody] = useState("");
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.dossier(dossier.property.id) });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard });
  };

  const create = useMutation({
    mutationFn: () => apiPost<NoteView>(`/api/properties/${dossier.property.id}/notes`, { body: newBody, pinned: false }),
    onSuccess: () => {
      setNewBody("");
      invalidate();
    },
  });

  const sorted = [...dossier.notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div>
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
        <Field label="New note">
          <TextArea
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder="Share something the other managers should know…"
            rows={3}
          />
        </Field>
        <Button onClick={() => create.mutate()} disabled={!newBody.trim() || create.isPending}>
          {create.isPending ? "Posting…" : "Post note"}
        </Button>
      </div>

      {sorted.length === 0 ? (
        <EmptyState title="No notes yet" detail="The first one you add shows up here for everyone." />
      ) : (
        <ul className="space-y-3">
          {sorted.map((note) => (
            <NoteCard key={note.id} note={note} propertyId={dossier.property.id} onChanged={invalidate} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteCard(props: { note: NoteView; propertyId: string; onChanged: () => void }): JSX.Element {
  const [draft, setDraft] = useState(props.note.body);
  const [conflict, setConflict] = useState<NoteView | null>(null);
  const [dirty, setDirty] = useState(false);

  const save = useMutation({
    mutationFn: (expectedVersion: number) => apiPatch<NoteView>(`/api/notes/${props.note.id}`, { body: draft, expectedVersion }),
    onSuccess: () => {
      setDirty(false);
      props.onChanged();
    },
    onError: (err) => {
      if (err instanceof ApiClientError && err.code === "VERSION_CONFLICT") {
        setConflict(err.current as NoteView);
      }
    },
  });

  const remove = useMutation({
    mutationFn: () => apiDelete(`/api/notes/${props.note.id}`),
    onSuccess: props.onChanged,
  });

  const togglePin = useMutation({
    mutationFn: () => apiPatch<NoteView>(`/api/notes/${props.note.id}`, { pinned: !props.note.pinned, expectedVersion: props.note.version }),
    onSuccess: props.onChanged,
  });

  return (
    <li className={`rounded-xl border bg-white p-3 ${props.note.pinned ? "border-brand-300" : "border-slate-200"}`}>
      <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
        <span>
          {props.note.author?.displayName ?? "Someone"} · {formatRelativeTime(props.note.updatedAt)}
          {props.note.pinned && " · Pinned"}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => togglePin.mutate()} className="tap-target text-xs font-semibold text-slate-500 hover:text-brand-600">
            {props.note.pinned ? "Unpin" : "Pin"}
          </button>
          <IconButton label="Delete note" onClick={() => remove.mutate()}>
            <TrashIcon width={16} height={16} />
          </IconButton>
        </div>
      </div>

      <LockedTextArea
        entityType="note"
        entityId={props.note.id}
        field="body"
        value={draft}
        onChange={(v) => {
          setDraft(v);
          setDirty(v !== props.note.body);
        }}
        mentionable
        rows={3}
      />

      {dirty && (
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { setDraft(props.note.body); setDirty(false); }}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate(props.note.version)} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}

      {conflict && (
        <VersionConflictDialog
          open
          onClose={() => setConflict(null)}
          fieldLabel="note"
          yourValue={draft}
          serverValue={conflict.body}
          changedBy={conflict.lastEditor?.displayName}
          onKeepMine={() => {
            save.mutate(conflict.version);
            setConflict(null);
          }}
          onTakeTheirs={() => {
            setDraft(conflict.body);
            setDirty(false);
            setConflict(null);
          }}
        />
      )}
    </li>
  );
}
