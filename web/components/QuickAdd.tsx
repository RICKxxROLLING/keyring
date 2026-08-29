import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { NoteView, PropertyView, WorkOrderView } from "../../shared/types";
import { apiGet, apiPost, apiUpload } from "../lib/api";
import { parseMoneyInput } from "../lib/format";
import { qk } from "../lib/query";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { Field, Select, TextArea, TextInput } from "./Form";
import { CameraIcon } from "./icons";

type QuickKind = "work_order" | "note" | "expense";

export function QuickAddSheet(props: { open: boolean; onClose: () => void; defaultPropertyId?: string }): JSX.Element {
  const [kind, setKind] = useState<QuickKind | null>(null);
  const [propertyId, setPropertyId] = useState(props.defaultPropertyId ?? "");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const properties = useQuery({
    queryKey: qk.properties,
    queryFn: () => apiGet<{ items: PropertyView[] }>("/api/properties"),
    enabled: props.open,
  });

  function reset() {
    setKind(null);
    setTitle("");
    setAmount("");
    setPhoto(null);
  }

  function close() {
    reset();
    props.onClose();
  }

  const createWorkOrder = useMutation({
    mutationFn: async () => {
      const wo = await apiPost<WorkOrderView>(`/api/properties/${propertyId}/work-orders`, {
        title,
        priority: "normal",
      });
      if (photo) {
        const form = new FormData();
        form.append("file", photo);
        form.append("parentType", "work_order");
        form.append("parentId", wo.id);
        await apiUpload("/api/uploads", form);
      }
      return wo;
    },
    onSuccess: (wo) => {
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      void queryClient.invalidateQueries({ queryKey: qk.dossier(propertyId) });
      close();
      navigate(`/p/${propertyId}/maintenance?wo=${wo.id}`);
    },
  });

  const createNote = useMutation({
    mutationFn: () => apiPost<NoteView>(`/api/properties/${propertyId}/notes`, { body: title, pinned: false }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      void queryClient.invalidateQueries({ queryKey: qk.dossier(propertyId) });
      close();
      navigate(`/p/${propertyId}/notes`);
    },
  });

  const createExpense = useMutation({
    mutationFn: () => {
      const cents = parseMoneyInput(amount) ?? 0;
      return apiPost(`/api/properties/${propertyId}/expenses`, {
        description: title,
        amountCents: cents,
        category: "other",
        incurredOn: new Date().toISOString().slice(0, 10),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      void queryClient.invalidateQueries({ queryKey: qk.dossier(propertyId) });
      close();
      navigate(`/p/${propertyId}/money`);
    },
  });

  const pending = createWorkOrder.isPending || createNote.isPending || createExpense.isPending;
  const canSubmit = propertyId && title.trim().length > 0 && (kind !== "expense" || parseMoneyInput(amount) !== null);

  function submit() {
    if (!canSubmit || !kind) return;
    if (kind === "work_order") createWorkOrder.mutate();
    else if (kind === "note") createNote.mutate();
    else createExpense.mutate();
  }

  return (
    <Dialog open={props.open} onClose={close} title="Quick add">
      <Field label="Property">
        <Select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
          <option value="">Choose a property…</option>
          {properties.data?.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>

      {!kind && (
        <div className="grid grid-cols-3 gap-2">
          <QuickKindButton label="Work order" onClick={() => setKind("work_order")} />
          <QuickKindButton label="Note" onClick={() => setKind("note")} />
          <QuickKindButton label="Expense" onClick={() => setKind("expense")} />
        </div>
      )}

      {kind && (
        <div className="mt-2">
          {kind === "work_order" && (
            <>
              <Field label="What needs doing?">
                <TextInput autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Leaking kitchen faucet" />
              </Field>
              <Field label="Photo (optional)">
                <label className="flex tap-target cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50">
                  <CameraIcon />
                  {photo ? photo.name : "Take or choose a photo"}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                  />
                </label>
              </Field>
            </>
          )}
          {kind === "note" && (
            <Field label="Note">
              <TextArea autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What's up?" />
            </Field>
          )}
          {kind === "expense" && (
            <>
              <Field label="Description">
                <TextInput autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Hardware store run" />
              </Field>
              <Field label="Amount">
                <TextInput inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </Field>
            </>
          )}

          <div className="mt-3 flex gap-2">
            <Button variant="secondary" onClick={() => setKind(null)} className="flex-1">
              Back
            </Button>
            <Button onClick={submit} disabled={!canSubmit || pending} className="flex-1">
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function QuickKindButton(props: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="tap-target flex flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700 hover:border-brand-400 hover:bg-brand-50"
    >
      {props.label}
    </button>
  );
}
