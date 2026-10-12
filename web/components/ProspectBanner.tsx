import { useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PropertyView } from "../../shared/types";
import { apiDelete, apiPatch } from "../lib/api";
import { qk } from "../lib/query";
import { useOptionalSession } from "../lib/session";
import { Button } from "./Button";
import { hero } from "./KeyGlyph";

type Confirming = null | "buy" | "pass" | "delete";

/**
 * The banner on a property you are considering rather than one you hold.
 *
 * It says plainly why the numbers on this page are missing from the portfolio
 * totals — otherwise a prospect looks like a bug in the dashboard — and it
 * carries the two actions that end the deciding: you bought it, or you didn't.
 *
 * Buying it is a PATCH of a single field. Nothing is copied and nothing is
 * re-entered: every project, estimate, note and photo gathered while deciding
 * is already on this property and simply starts counting.
 *
 * Passing on it is also a PATCH of a single field — archivedAt — which takes it
 * off the ring and out of "Needs a hand" without losing anything. A house you
 * walked away from comes back on the market often enough that the numbers and
 * notes are worth keeping, so the default is reversible. Deleting it for good
 * is offered only once it has been passed on, and only to an owner, because
 * the server already reserves deleting a property to owners.
 */
export function ProspectBanner({ property }: { property: PropertyView }): ReactElement {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isOwner = useOptionalSession()?.session?.user.role === "owner";
  const [confirming, setConfirming] = useState<Confirming>(null);
  const passed = property.archivedAt !== null;

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: qk.dossier(property.id) });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    void queryClient.invalidateQueries({ queryKey: qk.properties });
  };

  const patch = useMutation({
    mutationFn: (body: Partial<Pick<PropertyView, "stage" | "archivedAt">>) =>
      apiPatch<PropertyView>(`/api/properties/${property.id}`, {
        ...body,
        expectedVersion: property.version,
      }),
    onSuccess: (_result, body) => {
      setConfirming(null);
      refresh();
      // Passing on it clears it from the list you came from; staying on its
      // page would leave you looking at the thing you just put away.
      if (body.archivedAt) void navigate("/");
    },
  });

  const remove = useMutation({
    mutationFn: () => apiDelete<unknown>(`/api/properties/${property.id}`),
    onSuccess: () => {
      // Drop the cached page rather than refetching a property that is gone.
      queryClient.removeQueries({ queryKey: qk.dossier(property.id) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      void queryClient.invalidateQueries({ queryKey: qk.properties });
      void navigate("/");
    },
  });

  const busy = patch.isPending || remove.isPending;
  const error = patch.error ?? remove.error;

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        margin: "16px 0 0",
        padding: "10px 14px",
        borderRadius: 12,
        border: `1px dashed ${hero.border(property.heroColor, 0.45)}`,
        background: hero.tint(property.heroColor, passed ? 4 : 8),
      }}
    >
      <span style={{ minWidth: 0, flex: 1 }}>
        <span className="kr-label" style={{ display: "block", fontSize: 9 }}>
          {passed ? "Passed on" : "Considering"}
        </span>
        <span style={{ display: "block", fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>
          {confirming === "pass"
            ? "Take it off the ring? Its numbers, notes and photos are kept, and you can put it back."
            : confirming === "delete"
              ? "Delete this property and everything on it — numbers, notes, photos and files? This can't be undone."
              : passed
                ? "You passed on this one, so it's off the ring. Everything gathered while deciding is still here if it comes back on the market."
                : "You don't own this one yet, so it stays out of your unit count, rent roll and occupancy. Projects, estimates, notes and photos all work — that's the point."}
        </span>
        {error && (
          <span
            role="alert"
            style={{ display: "block", fontSize: 12, color: "var(--warn)", marginTop: 4 }}
          >
            {error.message}
          </span>
        )}
      </span>

      <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {confirming === "buy" ? (
          <>
            <Button onClick={() => patch.mutate({ stage: "owned" })} disabled={busy}>
              {patch.isPending ? "Adding…" : "Yes, it's mine"}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(null)}>
              Not yet
            </Button>
          </>
        ) : confirming === "pass" ? (
          <>
            <Button
              onClick={() => patch.mutate({ archivedAt: new Date().toISOString() })}
              disabled={busy}
            >
              {patch.isPending ? "Clearing…" : "Yes, clear it"}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(null)}>
              Keep it
            </Button>
          </>
        ) : confirming === "delete" ? (
          <>
            <Button variant="danger" onClick={() => remove.mutate()} disabled={busy}>
              {remove.isPending ? "Deleting…" : "Delete it for good"}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
          </>
        ) : passed ? (
          <>
            <Button
              variant="secondary"
              onClick={() => patch.mutate({ archivedAt: null })}
              disabled={busy}
            >
              {patch.isPending ? "Putting back…" : "Put it back on the ring"}
            </Button>
            {isOwner && (
              <Button variant="ghost" onClick={() => setConfirming("delete")}>
                Delete…
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setConfirming("buy")}>
              I bought it
            </Button>
            <Button variant="ghost" onClick={() => setConfirming("pass")}>
              We passed on it
            </Button>
          </>
        )}
      </span>
    </div>
  );
}
