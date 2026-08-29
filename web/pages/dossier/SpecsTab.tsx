import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SpecCategory, SpecEntryView } from "../../../shared/types";
import { apiPost } from "../../lib/api";
import { qk } from "../../lib/query";
import { useDossier } from "../../lib/dossier-context";
import { Button } from "../../components/Button";
import { EmptyState, Field, Select, TextInput } from "../../components/Form";
import { LockIcon } from "../../components/icons";

const CATEGORIES: SpecCategory[] = ["appliance", "filter", "paint", "shutoff", "code", "warranty", "utility", "other"];

export function SpecsTab(): JSX.Element {
  const dossier = useDossier();
  const [showNew, setShowNew] = useState(false);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [category, setCategory] = useState<SpecCategory>("appliance");
  const [isSecret, setIsSecret] = useState(false);
  const queryClient = useQueryClient();

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: qk.dossier(dossier.property.id) });
  }

  const create = useMutation({
    mutationFn: () => apiPost<SpecEntryView>(`/api/properties/${dossier.property.id}/specs`, { label, value, category, isSecret }),
    onSuccess: () => {
      setLabel("");
      setValue("");
      setIsSecret(false);
      setShowNew(false);
      invalidate();
    },
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">Spec vault</h2>
        <Button onClick={() => setShowNew((v) => !v)}>+ Entry</Button>
      </div>

      {showNew && (
        <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2">
          <Field label="Label">
            <TextInput autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Furnace filter size" />
          </Field>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value as SpecCategory)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Value">
            <TextInput value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <label className="mb-3 mt-6 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={isSecret} onChange={(e) => setIsSecret(e.target.checked)} />
            Sensitive (mask by default — gate codes, account numbers)
          </label>
          <Button onClick={() => create.mutate()} disabled={!label.trim() || create.isPending} className="sm:col-span-2">
            {create.isPending ? "Adding…" : "Add entry"}
          </Button>
        </div>
      )}

      {dossier.specs.length === 0 ? (
        <EmptyState title="Nothing in the vault yet" detail="Filter sizes, gate codes, warranty info, account numbers." />
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {dossier.specs.map((spec) => (
            <SpecRow key={spec.id} spec={spec} propertyId={dossier.property.id} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SpecRow(props: { spec: SpecEntryView; propertyId: string }): JSX.Element {
  const [revealed, setRevealed] = useState<string | null>(null);
  const reveal = useMutation({
    mutationFn: () => apiPost<{ id: string; value: string }>(`/api/specs/${props.spec.id}/reveal`),
    onSuccess: (res) => setRevealed(res.value),
  });

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="font-semibold text-slate-900">{props.spec.label}</p>
        <p className="text-sm text-slate-500">
          {props.spec.category}
          {props.spec.make ? ` · ${props.spec.make} ${props.spec.model ?? ""}` : ""}
        </p>
      </div>
      {props.spec.isSecret ? (
        revealed ? (
          <span className="font-mono text-sm font-semibold text-slate-800">{revealed}</span>
        ) : (
          <Button variant="secondary" onClick={() => reveal.mutate()} disabled={reveal.isPending} className="gap-1.5">
            <LockIcon width={14} height={14} />
            Reveal
          </Button>
        )
      ) : (
        <span className="text-sm font-semibold text-slate-800">{props.spec.value}</span>
      )}
    </li>
  );
}
