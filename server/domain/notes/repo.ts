// server/domain/notes/repo.ts
import { getDb } from "../../db/index.js";
import { camelRow } from "../../lib/rowmap.js";
import { listAttachmentsFor } from "../../uploads/storage.js";
import { notFound } from "../../lib/errors.js";
import { userRef } from "../common/access.js";
import type { Note, NoteView } from "../../../shared/types.js";

export function getNoteRow(id: string): Note {
  const row = getDb().prepare(`SELECT * FROM notes WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("Note");
  return camelRow<Note>(row);
}

export function toNoteView(note: Note): NoteView {
  return {
    ...note,
    author: userRef(note.createdBy),
    lastEditor: userRef(note.updatedBy),
    attachments: listAttachmentsFor("note", note.id),
  };
}

export function listNotes(propertyId: string, unitId?: string, pinned?: boolean): NoteView[] {
  const clauses = ["property_id = ?"];
  const params: unknown[] = [propertyId];
  if (unitId) {
    clauses.push("unit_id = ?");
    params.push(unitId);
  }
  if (pinned !== undefined) {
    clauses.push("pinned = ?");
    params.push(pinned ? 1 : 0);
  }
  const rows = getDb()
    .prepare(
      `SELECT * FROM notes WHERE ${clauses.join(" AND ")} ORDER BY pinned DESC, created_at DESC`,
    )
    .all(...params) as Record<string, unknown>[];
  return rows.map((r) => toNoteView(camelRow<Note>(r)));
}
