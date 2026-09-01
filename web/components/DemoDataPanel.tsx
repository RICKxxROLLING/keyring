import { useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost } from "../lib/api";
import { qk } from "../lib/query";
import { Button } from "./Button";

interface DemoStatus {
  present: boolean;
  properties: number;
  vendors: number;
  realProperties: number;
}

/**
 * Demo data on and off, without losing anyone's account.
 *
 * "I would like to be able to toggle demo data on and off without wiping the
 * database of users." The old answer was to delete the database file, which
 * took the accounts, the authenticator enrolments and the pending invites with
 * it — so trying the app and then starting for real meant setting everybody up
 * twice.
 *
 * Removal is a real delete, so it asks first and says exactly what goes and
 * what stays. The count of real properties is shown because that is the number
 * the person clicking this actually cares about protecting.
 */
export function DemoDataPanel(): ReactElement {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const status = useQuery({
    queryKey: ["admin", "demo"],
    queryFn: () => apiGet<DemoStatus>("/api/ops/demo"),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["admin", "demo"] });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    // The rail, search and every dossier read from these.
    void queryClient.invalidateQueries();
  }

  const load = useMutation({
    mutationFn: () => apiPost<{ loaded: boolean; message: string }>("/api/ops/demo"),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: () => apiDelete<{ removed: { properties: number; vendors: number; uploads: number } }>("/api/ops/demo"),
    onSuccess: () => {
      setConfirming(false);
      refresh();
    },
  });

  const s = status.data;

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 14,
        background: "var(--panel)",
        padding: 16,
      }}
    >
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Demo portfolio</h3>
      <p style={{ margin: "4px 0 14px", fontSize: 13, color: "var(--ink-3)" }}>
        Five fictional properties with tenants, work orders, rent and files, so there is something
        to look at before you have entered anything real.
      </p>

      {s && (
        <dl
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(min(120px, 100%), 1fr))",
            margin: "0 0 14px",
          }}
        >
          <Fact label="Demo keys" value={String(s.properties)} />
          <Fact label="Demo vendors" value={String(s.vendors)} />
          <Fact label="Your own keys" value={String(s.realProperties)} />
        </dl>
      )}

      {s && !s.present && (
        <>
          <Button onClick={() => load.mutate()} disabled={load.isPending || s.realProperties > 0}>
            {load.isPending ? "Loading…" : "Load demo data"}
          </Button>
          {s.realProperties > 0 && (
            <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
              You already have {s.realProperties} propert{s.realProperties === 1 ? "y" : "ies"} of
              your own. The demo only loads into an empty portfolio, so it can never be mixed in
              with your real records.
            </p>
          )}
        </>
      )}

      {s?.present && !confirming && (
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          Remove demo data
        </Button>
      )}

      {s?.present && confirming && (
        <div
          style={{
            border: "1px solid var(--warn-line, var(--line))",
            borderRadius: 12,
            background: "var(--panel-2)",
            padding: 14,
          }}
        >
          <p style={{ margin: "0 0 8px", fontSize: 13.5, fontWeight: 600 }}>
            Remove {s.properties} demo propert{s.properties === 1 ? "y" : "ies"} and everything on
            them?
          </p>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink-2)" }}>
            Their notes, work orders, tenants, leases, rent, expenses and files go with them, and
            this cannot be undone. <strong>Nothing else is touched</strong> — every user account,
            authenticator enrolment, invite and anything you entered yourself stays exactly as it
            is. A demo vendor you have since used on real work is kept too.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button onClick={() => remove.mutate()} disabled={remove.isPending}>
              {remove.isPending ? "Removing…" : "Yes, remove it"}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {load.data && !load.data.loaded && (
        <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
          {load.data.message}
        </p>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <dt className="kr-label" style={{ fontSize: 9 }}>
        {label}
      </dt>
      <dd className="kr-tabular" style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
        {value}
      </dd>
    </div>
  );
}
