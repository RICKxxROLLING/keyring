import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Upload } from "../../../shared/types";
import { apiUpload } from "../../lib/api";
import { qk } from "../../lib/query";
import { useDossier } from "../../lib/dossier-context";
import { formatRelativeTime } from "../../lib/format";
import { EmptyState } from "../../components/Form";
import { CameraIcon } from "../../components/icons";
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
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {dossier.attachments.map((u: Upload) => (
            <li key={u.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {u.kind === "image" ? (
                <img src={u.thumbUrl ?? u.url} alt={u.filename} className="h-28 w-full object-cover" />
              ) : (
                <div className="flex h-28 w-full items-center justify-center bg-slate-50 text-xs text-slate-500">PDF</div>
              )}
              <div className="p-2">
                <p className="truncate text-xs font-medium text-slate-700">{u.filename}</p>
                <p className="text-[11px] text-slate-400">{formatRelativeTime(u.createdAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
