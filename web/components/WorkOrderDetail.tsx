import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { User, WorkOrderCommentView, WorkOrderStatus, WorkOrderView } from "../../shared/types";
import { PRIORITIES, WORK_ORDER_STATUSES } from "../../shared/types";
import { apiGet, apiPatch, apiPost, apiUpload, ApiClientError } from "../lib/api";
import { qk } from "../lib/query";
import { formatDate, formatRelativeTime } from "../lib/format";
import { workOrderStatusDisplay } from "../lib/status";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { Field, Select, TextInput } from "./Form";
import { LockedTextArea } from "./LockedField";
import { StatusPill } from "./StatusPill";
import { VersionConflictDialog } from "./VersionConflictDialog";
import { CameraIcon } from "./icons";

export function WorkOrderDetail(props: { workOrder: WorkOrderView; onClose: () => void }): JSX.Element {
  const wo = props.workOrder;
  const queryClient = useQueryClient();
  const [description, setDescription] = useState(wo.description ?? "");
  const [conflict, setConflict] = useState<WorkOrderView | null>(null);
  const [commentBody, setCommentBody] = useState("");

  const users = useQuery({ queryKey: ["users", "assignable"], queryFn: () => apiGet<{ items: User[] }>("/api/users") });
  const comments = useQuery({
    queryKey: ["work-order-comments", wo.id],
    queryFn: () => apiGet<{ items: WorkOrderCommentView[] }>(`/api/work-orders/${wo.id}/comments`),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: qk.dossier(wo.propertyId) });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    void queryClient.invalidateQueries({ queryKey: qk.workOrder(wo.id) });
  }

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPatch<WorkOrderView>(`/api/work-orders/${wo.id}`, { ...body, expectedVersion: wo.version }),
    onSuccess: invalidate,
    onError: (err) => {
      if (err instanceof ApiClientError && err.code === "VERSION_CONFLICT") setConflict(err.current as WorkOrderView);
    },
  });

  const saveDescription = useMutation({
    mutationFn: () => apiPatch<WorkOrderView>(`/api/work-orders/${wo.id}`, { description, expectedVersion: wo.version }),
    onSuccess: invalidate,
    onError: (err) => {
      if (err instanceof ApiClientError && err.code === "VERSION_CONFLICT") setConflict(err.current as WorkOrderView);
    },
  });

  const addComment = useMutation({
    mutationFn: () => apiPost<WorkOrderCommentView>(`/api/work-orders/${wo.id}/comments`, { body: commentBody }),
    onSuccess: () => {
      setCommentBody("");
      void comments.refetch();
      invalidate();
    },
  });

  const attachPhoto = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("parentType", "work_order");
      form.append("parentId", wo.id);
      return apiUpload("/api/uploads", form);
    },
    onSuccess: invalidate,
  });

  const status = workOrderStatusDisplay(wo.status, wo.isOverdue);

  return (
    <Dialog open onClose={props.onClose} title={`WO-${wo.number} · ${wo.title}`} wide>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatusPill severity={status.severity} label={status.label} />
        {wo.unitLabel && <span className="text-sm text-slate-500">{wo.unitLabel}</span>}
        {wo.dueDate && <span className="text-sm text-slate-500">Due {formatDate(wo.dueDate)}</span>}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Status">
          <Select value={wo.status} onChange={(e) => patch.mutate({ status: e.target.value as WorkOrderStatus })}>
            {WORK_ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={wo.priority} onChange={(e) => patch.mutate({ priority: e.target.value })}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Assignee">
          <Select value={wo.assigneeId ?? ""} onChange={(e) => patch.mutate({ assigneeId: e.target.value || null })}>
            <option value="">Unassigned</option>
            {users.data?.items.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Description">
        <LockedTextArea
          entityType="work_order"
          entityId={wo.id}
          field="description"
          value={description}
          onChange={setDescription}
          mentionable
          rows={3}
        />
      </Field>
      {description !== (wo.description ?? "") && (
        <Button onClick={() => saveDescription.mutate()} disabled={saveDescription.isPending} className="mb-4">
          {saveDescription.isPending ? "Saving…" : "Save description"}
        </Button>
      )}

      <label className="tap-target mb-4 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50">
        <CameraIcon />
        {attachPhoto.isPending ? "Uploading…" : "Attach a photo"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) attachPhoto.mutate(file);
          }}
        />
      </label>

      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
        Comments ({comments.data?.items.length ?? 0})
      </h3>
      <ul className="mb-3 space-y-2">
        {comments.data?.items.map((c) => (
          <li key={c.id} className="rounded-lg bg-slate-50 p-2 text-sm">
            <p className="mb-0.5 text-xs font-semibold text-slate-500">
              {c.author?.displayName} · {formatRelativeTime(c.createdAt)}
            </p>
            <p className="whitespace-pre-wrap text-slate-800">{c.body}</p>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <TextInput value={commentBody} onChange={(e) => setCommentBody(e.target.value)} placeholder="Add a comment…" />
        <Button onClick={() => addComment.mutate()} disabled={!commentBody.trim() || addComment.isPending}>
          Post
        </Button>
      </div>

      {conflict && (
        <VersionConflictDialog
          open
          onClose={() => setConflict(null)}
          fieldLabel="work order"
          yourValue={description}
          serverValue={conflict.description ?? ""}
          onKeepMine={() => {
            saveDescription.mutate();
            setConflict(null);
          }}
          onTakeTheirs={() => {
            setDescription(conflict.description ?? "");
            setConflict(null);
          }}
        />
      )}
    </Dialog>
  );
}
