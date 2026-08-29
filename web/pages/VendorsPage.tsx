import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Page, Vendor } from "../../shared/types";
import { apiGet, apiPost } from "../lib/api";
import { qk } from "../lib/query";
import { Button } from "../components/Button";
import { EmptyState, Field, Spinner, TextInput } from "../components/Form";

export function VendorsPage(): JSX.Element {
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [trade, setTrade] = useState("");
  const [phone, setPhone] = useState("");
  const queryClient = useQueryClient();

  const vendors = useQuery({ queryKey: qk.vendors, queryFn: () => apiGet<Page<Vendor>>("/api/vendors") });

  const create = useMutation({
    mutationFn: () => apiPost<Vendor>("/api/vendors", { name, trade, phone: phone || null }),
    onSuccess: () => {
      setName("");
      setTrade("");
      setPhone("");
      setShowNew(false);
      void queryClient.invalidateQueries({ queryKey: qk.vendors });
    },
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-black text-slate-900">Vendors</h1>
        <Button onClick={() => setShowNew((v) => !v)}>+ Vendor</Button>
      </div>

      {showNew && (
        <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-3">
          <Field label="Name">
            <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Trade">
            <TextInput value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="Plumbing, electrical…" />
          </Field>
          <Field label="Phone">
            <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending} className="sm:col-span-3">
            {create.isPending ? "Adding…" : "Add vendor"}
          </Button>
        </div>
      )}

      {vendors.isPending && <Spinner />}
      {vendors.data && vendors.data.items.length === 0 && <EmptyState title="No vendors yet" />}
      {vendors.data && vendors.data.items.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {vendors.data.items.map((v) => (
            <li key={v.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-1 flex items-center justify-between">
                <p className="font-semibold text-slate-900">{v.name}</p>
                {v.preferred && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Preferred</span>}
              </div>
              <p className="text-sm text-slate-500">{v.trade}</p>
              {v.phone && <p className="text-sm text-slate-500">{v.phone}</p>}
              {v.rating && <p className="text-sm text-slate-500">{"★".repeat(v.rating)}{"☆".repeat(5 - v.rating)}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
