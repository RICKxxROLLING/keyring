import { useState, type ReactElement } from "react";
import type { Upload } from "../../shared/types";
import { formatDate } from "../lib/format";

/**
 * Attached files you can actually open.
 *
 * The tracking list: "Files listed in the papers sections of properties should
 * be able to be clicked on to expand and see them also allow for downloading or
 * printing." They were previously names on a page with nothing behind them.
 *
 * Everything goes through /api/uploads/:id/raw, which requires a session — the
 * files live outside any static root and are streamed by an authenticated
 * handler, so there is no public URL to link to and none is invented here.
 *
 * Printing is deliberately not a window.print() of the app page: that prints
 * the surrounding UI. Opening the file in its own tab hands it to the
 * browser's own PDF or image viewer, which already has print, zoom and rotate
 * and does them better than anything reimplemented here.
 */
export function AttachmentList({ uploads }: { uploads: Upload[] }): ReactElement | null {
  if (uploads.length === 0) return null;
  return (
    <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 8 }}>
      {uploads.map((u) => (
        <li key={u.id}>
          <FileRow upload={u} />
        </li>
      ))}
    </ul>
  );
}

function FileRow({ upload }: { upload: Upload }): ReactElement {
  const [preview, setPreview] = useState(false);
  const rawUrl = `/api/uploads/${upload.id}/raw`;
  const isImage = upload.kind === "image";

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 12,
        background: "var(--panel)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
        <DocMark kind={upload.kind} />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: "block",
              fontSize: 13.5,
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {upload.filename}
          </span>
          <span className="kr-label" style={{ fontSize: 9 }}>
            {formatBytes(upload.sizeBytes)} · {formatDate(upload.createdAt.slice(0, 10))}
          </span>
        </span>

        <button
          type="button"
          onClick={() => setPreview((v) => !v)}
          aria-expanded={preview}
          className="kr-btn kr-btn-ghost"
          style={{ minHeight: 36, padding: "0 10px", fontSize: 12.5 }}
        >
          {preview ? "Hide" : "View"}
        </button>
        {/* target=_blank gets the browser's own viewer, which already has
            print and zoom. rel=noopener because the opened document should
            not get a handle back to this window. */}
        <a
          href={rawUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="kr-btn kr-btn-ghost"
          style={{ minHeight: 36, padding: "0 10px", fontSize: 12.5 }}
        >
          Open
        </a>
        <a
          href={rawUrl}
          download={upload.filename}
          className="kr-btn kr-btn-ghost"
          style={{ minHeight: 36, padding: "0 10px", fontSize: 12.5 }}
        >
          Download
        </a>
      </div>

      {preview && (
        <div style={{ borderTop: "1px solid var(--line-soft)", background: "var(--panel-2)" }}>
          {isImage ? (
            <img
              src={rawUrl}
              alt={upload.filename}
              style={{ display: "block", width: "100%", height: "auto", maxHeight: 520, objectFit: "contain" }}
            />
          ) : (
            // PDFs are served Content-Disposition: attachment under a sandbox
            // CSP, so they cannot be framed inline — that is deliberate, and
            // not worth weakening for a preview. Open handles it.
            <p style={{ margin: 0, padding: "14px 12px", fontSize: 13, color: "var(--ink-2)" }}>
              PDFs open in their own tab, where your browser's viewer gives you
              print and zoom. Use <strong>Open</strong> above.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The 13x17 outlined document mark from the design handoff's Papers panel. */
function DocMark({ kind }: { kind: string }): ReactElement {
  return (
    <svg width="14" height="18" viewBox="0 0 14 18" aria-hidden="true" style={{ flex: "none" }}>
      <path
        d="M1 1h7l5 5v11H1z"
        fill="none"
        stroke={kind === "image" ? "var(--ink-3)" : "var(--ink-2)"}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8 1v5h5" fill="none" stroke="var(--ink-3)" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
