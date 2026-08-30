import type { CSSProperties, ReactElement } from "react";

/**
 * The key glyph — the Keyring design language's central motif.
 *
 * Built from primitives rather than an icon font or an imported SVG, exactly as
 * the handoff specifies. Three sizes with hand-tuned geometry (they are not a
 * single scale factor; the bow border and teeth are tuned per size so the shape
 * stays crisp at 22px and still reads as drawn at 44px).
 *
 * The bow's hole is filled with the SURFACE colour, not left transparent. That
 * is load-bearing in the sidebar: the metal ring wire passes behind the keys,
 * and the hole is what lets the wire show through. A transparent hole would let
 * the rail background show instead — same colour on the rail, wrong everywhere
 * else, e.g. on a card.
 */

export type KeyGlyphSize = "card" | "rail" | "hero";

interface Geometry {
  w: number;
  h: number;
  bow: number;
  bowBorder: number;
  shaftW: number;
  shaftH: number;
  shaftLeft: number;
  shaftTop: number;
  tooth1: { w: number; h: number; left: number; top: number };
  tooth2: { w: number; h: number; left: number; top: number };
}

const GEOMETRY: Record<KeyGlyphSize, Geometry> = {
  // 34x22 — property cards
  card: {
    w: 34, h: 22, bow: 20, bowBorder: 5,
    shaftW: 16, shaftH: 4, shaftLeft: 17, shaftTop: 9,
    tooth1: { w: 3, h: 5, left: 24, top: 13 },
    tooth2: { w: 3, h: 4, left: 29, top: 13 },
  },
  // 42x28 — sidebar rail
  rail: {
    w: 42, h: 28, bow: 25, bowBorder: 6,
    shaftW: 20, shaftH: 5, shaftLeft: 22, shaftTop: 11,
    tooth1: { w: 4, h: 6, left: 31, top: 16 },
    tooth2: { w: 3, h: 4, left: 38, top: 16 },
  },
  // 66x44 — property detail header
  hero: {
    w: 66, h: 44, bow: 40, bowBorder: 9,
    shaftW: 30, shaftH: 8, shaftLeft: 34, shaftTop: 18,
    tooth1: { w: 6, h: 9, left: 48, top: 26 },
    tooth2: { w: 5, h: 6, left: 58, top: 26 },
  },
};

export interface KeyGlyphProps {
  /** The property's stored hero colour. Falls back to a neutral key. */
  color: string | null;
  size?: KeyGlyphSize;
  /**
   * The colour BEHIND the glyph, painted inside the bow's hole. Defaults to the
   * panel token; pass the rail token in the sidebar so the ring wire shows
   * through, or a tinted surface on a washed header.
   */
  holeColor?: string;
  /** Decorative by default — the property name is always adjacent. */
  title?: string;
}

export function KeyGlyph({
  color,
  size = "rail",
  holeColor = "var(--panel)",
  title,
}: KeyGlyphProps): ReactElement {
  const g = GEOMETRY[size];
  const hero = color ?? "var(--metal)";

  const wrap: CSSProperties = { position: "relative", width: g.w, height: g.h, flex: "none" };
  const bow: CSSProperties = {
    position: "absolute",
    left: 0,
    top: (g.h - g.bow) / 2,
    width: g.bow,
    height: g.bow,
    borderRadius: 999,
    border: `${g.bowBorder}px solid ${hero}`,
    background: holeColor,
    boxSizing: "border-box",
  };
  const bar = (w: number, h: number, left: number, top: number): CSSProperties => ({
    position: "absolute",
    left,
    top,
    width: w,
    height: h,
    borderRadius: 2,
    background: hero,
  });

  return (
    <span
      style={wrap}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <span style={bow} />
      <span style={bar(g.shaftW, g.shaftH, g.shaftLeft, g.shaftTop)} />
      <span style={bar(g.tooth1.w, g.tooth1.h, g.tooth1.left, g.tooth1.top)} />
      <span style={bar(g.tooth2.w, g.tooth2.h, g.tooth2.left, g.tooth2.top)} />
    </span>
  );
}

/**
 * Hero derivations from the handoff, as helpers so the ratios live in one
 * place rather than being retyped at each call site.
 */
export const hero = {
  /** Washes: header 11%, ledger total row 8%, request card 7%, active rail row 12%. */
  tint: (color: string | null, pct: number): string =>
    color ? `color-mix(in oklab, ${color} ${pct}%, var(--panel))` : "var(--panel)",
  /** Tint borders sit at 0.28-0.35 alpha; card hover border at 0.55. */
  border: (color: string | null, alpha = 0.3): string =>
    color ? `color-mix(in oklab, ${color} ${Math.round(alpha * 100)}%, transparent)` : "var(--line)",
  /** Pill and badge fills sit at 0.14-0.18 alpha. */
  pill: (color: string | null, alpha = 0.16): string =>
    color ? `color-mix(in oklab, ${color} ${Math.round(alpha * 100)}%, transparent)` : "var(--panel-2)",
  /** Solid fills: bars, key glyphs, primary buttons. */
  solid: (color: string | null): string => color ?? "var(--metal)",
};
