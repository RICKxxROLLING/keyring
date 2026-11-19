import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { PropertyView } from "../../shared/types";
import { apiGet } from "../lib/api";
import { qk } from "../lib/query";
import { formatDate } from "../lib/format";
import { KeyGlyph } from "./KeyGlyph";

/**
 * Prospects you passed on, folded away under the ring.
 *
 * Passing on a house takes it off the ring, but it should not vanish: they come
 * back on the market, and the numbers gathered the first time are the reason
 * to look again. This is where to find one, put it back, or (as an owner)
 * delete it for good — those actions live on its own page's banner.
 *
 * Renders nothing at all until there is something to show, so a portfolio with
 * no passed prospects does not carry an empty section about them.
 */
export function PassedOnList(): ReactElement | null {
  const all = useQuery({
    // Under qk.properties so anything that invalidates the property list —
    // passing on one, putting one back — refreshes this too.
    queryKey: [...qk.properties, "includeArchived"],
    queryFn: () => apiGet<{ items: PropertyView[] }>("/api/properties?includeArchived=true"),
  });

  const passed = (all.data?.items ?? []).filter((p) => p.stage === "prospect" && p.archivedAt);
  if (passed.length === 0) return null;

  return (
    <details style={{ margin: "18px 0 0" }}>
      <summary className="kr-label" style={{ cursor: "pointer", color: "var(--ink-3)" }}>
        Passed on · {passed.length}
      </summary>
      <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 6 }}>
        {passed.map((p) => (
          <li key={p.id}>
            <Link
              to={`/p/${p.id}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                color: "var(--ink-2)",
                fontSize: 14,
              }}
            >
              <KeyGlyph color={p.heroColor} size="rail" holeColor="transparent" />
              <span>
                {p.name}
                <span style={{ color: "var(--ink-3)" }}>
                  {" "}
                  · {p.city}, passed {formatDate(p.archivedAt!.slice(0, 10))}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
