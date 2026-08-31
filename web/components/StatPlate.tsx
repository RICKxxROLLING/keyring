import type { ReactElement, ReactNode } from "react";

/**
 * A dashboard stat plate: mono label, a large serif figure with a quiet
 * sidekick, a visual (bar / bars / dots), and one line of context underneath.
 *
 * The handoff specifies three of these and they share a skeleton but not a
 * visual — one has a progress bar, one has a bar per door, one has a dot per
 * request. So the visual is a slot rather than a prop soup.
 */
export function StatPlate(props: {
  label: string;
  figure: string;
  /** The quiet half: "of $19,100", "of 12", "open requests". */
  sidekick?: string;
  /** Bars, dots, or a progress track. */
  visual?: ReactNode;
  /** One line of context. The thing you actually act on. */
  footnote?: string;
  /** Colours the figure — used for the "all in" / open-request cases. */
  figureColor?: string;
}): ReactElement {
  return (
    <div
      style={{
        background: "var(--panel-2)",
        border: "1px solid var(--line)",
        borderRadius: 16,
        padding: 20,
      }}
    >
      <span className="kr-label">{props.label}</span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "10px 0 14px" }}>
        <span
          className="kr-display kr-tabular"
          style={{
            fontSize: 30,
            lineHeight: 1,
            letterSpacing: "-0.02em",
            color: props.figureColor ?? "var(--ink)",
          }}
        >
          {props.figure}
        </span>
        {props.sidekick && (
          <span style={{ fontSize: 13.5, color: "var(--ink-2)" }}>{props.sidekick}</span>
        )}
      </div>
      {props.visual}
      {props.footnote && (
        <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
          {props.footnote}
        </p>
      )}
    </div>
  );
}

/** A single 6px progress track. */
export function ProgressBar({
  pct,
  color,
}: {
  pct: number;
  color: string;
}): ReactElement {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{ height: 6, borderRadius: 999, background: "var(--line-soft)", overflow: "hidden" }}
    >
      <div style={{ width: `${clamped}%`, height: "100%", background: color, borderRadius: 999 }} />
    </div>
  );
}

/**
 * One 6px bar per door, coloured by the property that owns it — so the vacant
 * door is visible as a gap in a specific property's run, not just a number.
 */
export function DoorBars({
  doors,
}: {
  doors: { key: string; color: string | null; filled: boolean }[];
}): ReactElement {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {doors.map((d) => (
        <span
          key={d.key}
          style={{
            flex: 1,
            height: 6,
            borderRadius: 999,
            background: d.filled ? (d.color ?? "var(--metal)") : "var(--line-soft)",
          }}
        />
      ))}
    </div>
  );
}

/** One 10px dot per open request, in the owning property's hero colour. */
export function RequestDots({
  dots,
}: {
  dots: { key: string; color: string | null }[];
}): ReactElement {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {dots.slice(0, 12).map((d) => (
        <span
          key={d.key}
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: d.color ?? "var(--metal)",
          }}
        />
      ))}
    </div>
  );
}
