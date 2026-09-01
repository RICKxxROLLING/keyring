import type { ReactElement } from "react";

/**
 * The Keyring mark: an open ring with a bead in the gap, and a key hanging in it.
 *
 * From the supplied icon set (assets/keyring-mark.svg). This is the brand mark
 * and it means the WHOLE ring — the portfolio, home, everything. It is
 * deliberately a different object from KeyGlyph, which is one key and therefore
 * one property. Using the ring for "all" and a key for "one" is the whole
 * metaphor, so the two must never be interchangeable.
 *
 * The ring and the key take `currentColor` so the mark inherits whatever it
 * sits on. The bead is terracotta in both themes — the same fixed-in-both-
 * themes treatment the hero palette gets, because its lightness already sits in
 * a band that works on either ground.
 */
export function RingMark({
  size = 28,
  withKey = true,
  title,
}: {
  size?: number;
  /** The bare ring and bead read better below about 20px. */
  withKey?: boolean;
  title?: string;
}): ReactElement {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: "block", flex: "none" }}
    >
      {/* The ring, left open at the top right so the bead sits in the gap. */}
      <path
        d="M 71.9 31.5 A 30 30 0 1 1 56.7 22.8"
        fill="none"
        stroke="currentColor"
        strokeWidth={withKey ? 9 : 12}
        strokeLinecap="round"
      />
      {withKey && (
        <g fill="currentColor">
          <circle cx="50" cy="47" r="7.6" />
          <path d="M 46.4 51.5 L 44.3 67.5 L 55.7 67.5 L 53.6 51.5 Z" />
        </g>
      )}
      <circle cx="65" cy="26" r={withKey ? 6.5 : 9} fill="var(--hero-terracotta, #c8794f)" />
    </svg>
  );
}

/**
 * The portfolio mark: a closed ring carrying one bead per hero colour.
 *
 * From assets/keyring-ring-alt.svg. Six beads, six palette colours — it says
 * "a set of properties" where RingMark says "Keyring". Used where the subject
 * is the portfolio itself rather than the app.
 */
export function PortfolioRing({ size = 28, title }: { size?: number; title?: string }): ReactElement {
  const beads: [number, number, string][] = [
    [39.7, 23.8, "#c8794f"],
    [60.3, 23.8, "#7c9455"],
    [76.0, 37.0, "#cfa14b"],
    [79.5, 57.2, "#b8574c"],
    [69.3, 75.0, "#9b7699"],
    [50.0, 82.0, "#6a717c"],
  ];
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: "block", flex: "none" }}
    >
      <circle cx="50" cy="52" r="30" fill="none" stroke="var(--metal)" strokeWidth="6" />
      {beads.map(([cx, cy, fill]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="5.6" fill={fill} />
      ))}
    </svg>
  );
}
