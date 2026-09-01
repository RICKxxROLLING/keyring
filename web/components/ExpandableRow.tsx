import { useId, useState, type ReactElement, type ReactNode } from "react";
import { hero } from "./KeyGlyph";

/**
 * A list row that opens in place to show everything.
 *
 * Six separate items on the tracking list were the same complaint: a row shows
 * a summary and clicking it does nothing, so the detail you actually entered —
 * the deposit, the receipt, whether an expense recurs — is invisible. Rather
 * than six bespoke detail pages, this is one row that expands.
 *
 * In place rather than a modal on purpose: these are things you scan down a
 * list and compare against each other ("which of these was the recurring
 * one?"). A modal answers one question and then makes you reopen it for the
 * next row.
 *
 * It is a real <button> with aria-expanded and a controlled region, so it works
 * from the keyboard and announces itself, which a clickable <div> would not.
 */
export function ExpandableRow(props: {
  /** Always visible. The summary line. */
  summary: ReactNode;
  /** Revealed on open. Rendered lazily so a long list stays cheap. */
  children: ReactNode;
  /** Hero colour of the owning property, for the left edge. */
  color?: string | null;
  /** Open on first render — used when a deep link names this row. */
  defaultOpen?: boolean;
  /** Accessible name for the toggle, e.g. "Lease for Unit 2". */
  label: string;
}): ReactElement {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const regionId = useId();

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderLeft: props.color ? `4px solid ${hero.solid(props.color)}` : "1px solid var(--line)",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={regionId}
        aria-label={`${props.label} — ${open ? "collapse" : "expand"}`}
        className="kr-expand-toggle"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          minHeight: 56,
          padding: "12px 14px",
          background: "transparent",
          border: 0,
          textAlign: "left",
          color: "var(--ink)",
          cursor: "pointer",
        }}
      >
        <span style={{ minWidth: 0, flex: 1 }}>{props.summary}</span>
        <Chevron open={open} />
      </button>

      {open && (
        <div
          id={regionId}
          style={{
            padding: "2px 14px 14px",
            borderTop: "1px solid var(--line-soft)",
            background: "var(--panel-2)",
          }}
        >
          {props.children}
        </div>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={{
        flex: "none",
        color: "var(--ink-3)",
        transform: open ? "rotate(180deg)" : "none",
        transition: "transform 160ms ease",
      }}
    >
      <path
        d="M4 6l4 4 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Key/value rows inside an expanded panel.
 *
 * Skips entries whose value is null or empty rather than printing "—" for
 * every unset field: a panel of a dozen dashes hides the three facts that are
 * actually there.
 */
export function DetailGrid(props: {
  items: { label: string; value: ReactNode }[];
}): ReactElement | null {
  const shown = props.items.filter(
    (i) => i.value !== null && i.value !== undefined && i.value !== "",
  );
  if (shown.length === 0) return null;

  return (
    <dl
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))",
        gap: "10px 20px",
        margin: "12px 0 0",
      }}
    >
      {shown.map((i) => (
        <div key={i.label}>
          <dt className="kr-label" style={{ fontSize: 9.5 }}>
            {i.label}
          </dt>
          <dd style={{ margin: "3px 0 0", fontSize: 13.5, color: "var(--ink)" }}>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
