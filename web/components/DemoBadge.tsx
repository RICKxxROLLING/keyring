import type { ReactElement } from "react";

/**
 * "DEMO" — on anything the demo loader made up.
 *
 * Demo data can be loaded alongside real properties now, so the two sit side by
 * side in the same ring, the same dashboard and the same search results. That
 * only works if telling them apart takes no memory at all, so this appears
 * wherever a property does.
 *
 * Deliberately not a hero colour and not a status colour: it is neither an
 * identity nor a state, it is a warning that the numbers underneath are
 * fiction. It borrows the caution tone the rest of the app uses for "look at
 * this before you trust it".
 */
export function DemoBadge({ size = "normal" }: { size?: "normal" | "small" }): ReactElement {
  const small = size === "small";
  return (
    <span
      className="kr-label"
      title="Sample data created by the demo loader — not a real property."
      style={{
        flex: "none",
        display: "inline-block",
        padding: small ? "1px 5px" : "2px 7px",
        borderRadius: 4,
        fontSize: small ? 8 : 8.5,
        letterSpacing: "0.14em",
        background: "var(--warn-fill)",
        color: "var(--warn)",
        border: "1px solid var(--warn)",
        lineHeight: 1.5,
      }}
    >
      Demo
    </span>
  );
}
