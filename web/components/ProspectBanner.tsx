import { useState, type ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PropertyView } from "../../shared/types";
import { apiPatch } from "../lib/api";
import { qk } from "../lib/query";
import { Button } from "./Button";
import { hero } from "./KeyGlyph";

/**
 * The banner on a property you are considering rather than one you hold.
 *
 * It says plainly why the numbers on this page are missing from the portfolio
 * totals — otherwise a prospect looks like a bug in the dashboard — and it
 * carries the one action that changes that.
 *
 * Buying it is a PATCH of a single field. Nothing is copied and nothing is
 * re-entered: every project, estimate, note and photo gathered while deciding
 * is already on this property and simply starts counting.
 */
export function ProspectBanner({ property }: { property: PropertyView }): ReactElement {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const buy = useMutation({
    mutationFn: () =>
      apiPatch<PropertyView>(`/api/properties/${property.id}`, {
        stage: "owned",
        expectedVersion: property.version,
      }),
    onSuccess: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: qk.dossier(property.id) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      void queryClient.invalidateQueries({ queryKey: qk.properties });
    },
  });

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
        background: hero.tint(property.heroColor, 8),
      }}
    >
      <span style={{ minWidth: 0, flex: 1 }}>
        <span className="kr-label" style={{ display: "block", fontSize: 9 }}>
          Considering
        </span>
        <span style={{ display: "block", fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>
          You don&apos;t own this one yet, so it stays out of your unit count, rent roll and
          occupancy. Projects, estimates, notes and photos all work — that&apos;s the point.
        </span>
      </span>

      {confirming ? (
        <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button onClick={() => buy.mutate()} disabled={buy.isPending}>
            {buy.isPending ? "Adding…" : "Yes, it's mine"}
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            Not yet
          </Button>
        </span>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          I bought it
        </Button>
      )}
    </div>
  );
}
