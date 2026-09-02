import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { hero } from "./KeyGlyph";
import { pulseProps, useChangePulse } from "../lib/change-pulse";

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
  /**
   * The row this displays. Given both, the row washes in someone else's
   * colour when THEY change it — see lib/change-pulse.
   */
  entityType?: string;
  entityId?: string;
}): ReactElement {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  /**
   * Children mount on first open and stay mounted.
   *
   * Lazily, because a list of forty rows should not render forty panels
   * nobody has asked for. Permanently, because collapsing needs content to
   * collapse: unmount it and the row snaps shut with an empty box while the
   * height transition plays to nothing.
   */
  const [everOpened, setEverOpened] = useState(props.defaultOpen ?? false);
  const regionId = useId();
  const pulse = useChangePulse(props.entityType, props.entityId);
  const wash = pulseProps(pulse);

  /**
   * The panel's own height, measured, so it can be animated to.
   *
   * There are two CSS-only ways to do this and both give something up.
   * max-height needs a ceiling big enough for the tallest panel, which makes
   * every shorter one snap open early and close late. grid-template-rows
   * 0fr -> 1fr is exact and needs no measuring, but animating that property is
   * recent enough (Chrome 107, Firefox 129, Safari 18) that an older phone
   * gets no animation at all.
   *
   * A measured pixel height works everywhere and is exact, and it is the only
   * one of the three that also handles the panel CHANGING size while open —
   * adding a budget line, attaching a receipt — which happens on half these
   * tabs.
   *
   * null means "not measured yet"; the panel falls back to `auto` so a browser
   * without ResizeObserver shows the content rather than clipping it to zero.
   */
  const innerRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = (): void => setContentHeight(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [everOpened]);

  return (
    <div
      className={wash.className}
      style={
        {
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderLeft: props.color ? `4px solid ${hero.solid(props.color)}` : "1px solid var(--line)",
          borderRadius: 14,
          overflow: "hidden",
          ...wash.style,
        } as CSSProperties
      }
    >
      <button
        type="button"
        onClick={() => {
          setEverOpened(true);
          setOpen((v) => !v);
        }}
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

      {/* `inert` while closed because the panel is still in the DOM at zero
          height: without it you can tab into content you cannot see, and a
          screen reader reads a row that looks collapsed. */}
      <div
        id={regionId}
        className="kr-expand-region"
        data-open={open}
        inert={!open}
        style={{ height: open ? (contentHeight ?? "auto") : 0 }}
      >
        <div
          ref={innerRef}
          style={{
            padding: "2px 14px 14px",
            borderTop: "1px solid var(--line-soft)",
            background: "var(--panel-2)",
          }}
        >
          {everOpened ? props.children : null}
        </div>
      </div>
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
