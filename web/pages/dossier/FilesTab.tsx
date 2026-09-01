import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Upload } from "../../../shared/types";
import { apiUpload } from "../../lib/api";
import { qk } from "../../lib/query";
import { useDossier } from "../../lib/dossier-context";
import { formatRelativeTime } from "../../lib/format";
import { EmptyState } from "../../components/Form";
import { CameraIcon } from "../../components/icons";
import { AttachmentList } from "../../components/AttachmentList";
import type { ReactElement } from "react";

export function FilesTab(): ReactElement {
  const dossier = useDossier();
  const queryClient = useQueryClient();

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("parentType", "property");
      form.append("parentId", dossier.property.id);
      return apiUpload("/api/uploads", form);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.dossier(dossier.property.id) }),
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">Files</h2>
        <label className="tap-target flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <CameraIcon width={16} height={16} />
          {upload.isPending ? "Uploading…" : "Add file"}
          <input
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
            }}
          />
        </label>
      </div>

      {dossier.attachments.length === 0 ? (
        <EmptyState title="No files yet" detail="Photos and documents attached anywhere on this property show up here." />
      ) : (
        <>
          {/* A grid of thumbnails to scan, and a list you can act on.
              Previously the tiles were inert: names and pictures with nothing
              behind them, so a lease you had filed could be seen but not
              opened, downloaded or printed. */}
          <ul
            style={{
              listStyle: "none",
              margin: "0 0 22px",
              padding: 0,
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fill, minmax(min(150px, 100%), 1fr))",
            }}
          >
            {dossier.attachments.map((u: Upload) => (
              <li key={u.id}>
                <a
                  href={`/api/uploads/${u.id}/raw`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open ${u.filename}`}
                  className="kr-card"
                  style={{
                    display: "block",
                    overflow: "hidden",
                    borderRadius: 14,
                    border: "1px solid var(--line)",
                    background: "var(--panel)",
                    color: "var(--ink)",
                  }}
                >
                  {u.kind === "image" ? (
                    <img
                      src={u.thumbUrl ?? u.url}
                      alt={u.filename}
                      style={{ display: "block", width: "100%", height: 112, objectFit: "cover" }}
                    />
                  ) : (
                    <span
                      className="kr-label"
                      style={{
                        display: "grid",
                        placeItems: "center",
                        height: 112,
                        background: "var(--panel-2)",
                      }}
                    >
                      PDF
                    </span>
                  )}
                  <span style={{ display: "block", padding: "8px 10px 10px" }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: 12.5,
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {u.filename}
                    </span>
                    <span className="kr-label" style={{ fontSize: 9 }}>
                      {formatRelativeTime(u.createdAt)}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>

          <h3 className="kr-label" style={{ marginBottom: 4 }}>
            All files
          </h3>
          <AttachmentList uploads={dossier.attachments} />
        </>
      )}
    </div>
  );
}
