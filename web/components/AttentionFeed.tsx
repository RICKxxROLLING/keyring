import { Link } from "react-router-dom";
import type { ReactElement } from "react";
import type { AttentionItem, PropertyCard } from "../../shared/types";
import { formatDaysOut } from "../lib/format";
import { ATTENTION_KIND_LABEL } from "../lib/status";
import { EmptyState } from "./Form";

/**
 * "Needs a hand" — the cross-property feed.
 *
 * Renders every AttentionKind. The leading dot is the owning property's HERO
 * colour, which is the point of the feed: five properties' items interleave
 * here, and colour is what lets the eye group them without reading a word.
 *
 * Severity is deliberately NOT carried by that dot. Hero is identity, status
 * is state — collapsing them would mean you could no longer tell "urgent" from
 * "belongs to the red property". Age carries urgency instead, in mono, which is
 * also what the design does.
 */
export function AttentionFeed(props: {
  items: AttentionItem[];
  properties?: PropertyCard[];
}): ReactElement {
  if (props.items.length === 0) {
    return (
      <EmptyState
        title="Nothing needs attention"
        detail="You're all caught up across every property."
      />
    );
  }

  const heroFor = (propertyId: string): string | null =>
    props.properties?.find((p) => p.id === propertyId)?.heroColor ?? null;

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {props.items.map((item) => (
        <li key={item.id} style={{ borderTop: "1px solid var(--line-soft)" }}>
          <Link
            to={item.url}
            className="kr-attention-row"
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: "12px 4px",
              minHeight: 44,
              color: "var(--ink)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                flex: "none",
                marginTop: 6,
                width: 9,
                height: 9,
                borderRadius: 999,
                background: heroFor(item.propertyId) ?? "var(--metal)",
              }}
            />
            <span style={{ minWidth: 0, flex: 1 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 14,
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.title}
              </span>
              <span
                style={{
                  display: "block",
                  marginTop: 2,
                  fontSize: 12.5,
                  color: "var(--ink-3)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.propertyName}
                {item.unitLabel ? ` · ${item.unitLabel}` : ""}
                {" · "}
                {/* The kind stays its own node, not concatenated into the line:
                    it is the one part a reader scans for ("rent unpaid" vs
                    "lease expiring"), and keeping it addressable is what lets a
                    test assert every AttentionKind actually renders. */}
                <span>{ATTENTION_KIND_LABEL[item.kind]}</span>
                {item.detail ? ` · ${item.detail}` : ""}
              </span>
            </span>
            {item.daysOut !== null && (
              <span
                className="kr-label kr-tabular"
                style={{ flex: "none", marginTop: 3, fontSize: 10 }}
              >
                {formatDaysOut(item.daysOut)}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
