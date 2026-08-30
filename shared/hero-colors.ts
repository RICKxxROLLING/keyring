/**
 * The Keyring hero palette — one colour per property, from the design handoff.
 *
 * Lightness is deliberately held between 0.61 and 0.76 across all six so that
 * every hero reads legibly on warm paper AND on dark slate without needing a
 * per-theme variant. That is why these are identical in both themes while
 * every other colour token flips.
 *
 * Shared between server (assignment on create, and the seed) and web (the
 * colour picker when cutting a new key), so the two can never drift.
 */

export interface HeroColor {
  /** Stable key, stored nowhere — the colour string itself is what persists. */
  readonly id: string;
  /** Human name, used in the picker. */
  readonly name: string;
  /** The stored value: a CSS colour, written to properties.hero_color. */
  readonly value: string;
  /**
   * A darker variant for text sitting ON a tint of this hero, where the hero
   * itself would not carry enough contrast. Only some of the palette needs
   * one; the lighter members are legible as-is.
   */
  readonly onTint?: string;
}

export const HERO_COLORS: readonly HeroColor[] = [
  { id: "terracotta", name: "Terracotta", value: "oklch(0.665 0.125 42)", onTint: "oklch(0.53 0.125 42)" },
  { id: "olive", name: "Olive", value: "oklch(0.655 0.085 128)", onTint: "oklch(0.45 0.09 128)" },
  { id: "ochre", name: "Ochre", value: "oklch(0.755 0.110 82)" },
  { id: "brick", name: "Brick", value: "oklch(0.615 0.115 28)", onTint: "oklch(0.55 0.115 28)" },
  { id: "sage", name: "Sage", value: "oklch(0.665 0.060 175)" },
  { id: "heather", name: "Heather", value: "oklch(0.650 0.070 320)", onTint: "oklch(0.52 0.070 320)" },
];

/**
 * Pick the next hero colour for a new property.
 *
 * Chooses the least-used colour in the portfolio, so a small ring never
 * repeats a colour and a large one spreads evenly. Ties break by palette
 * order, which keeps the result deterministic — the same portfolio always
 * produces the same next colour, including after a restore from backup.
 */
export function nextHeroColor(inUse: readonly (string | null)[]): string {
  const counts = new Map<string, number>(HERO_COLORS.map((c) => [c.value, 0]));
  for (const value of inUse) {
    if (value && counts.has(value)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: string = HERO_COLORS[0]?.value ?? "oklch(0.665 0.125 42)";
  let bestCount = Number.POSITIVE_INFINITY;
  for (const c of HERO_COLORS) {
    const n = counts.get(c.value) ?? 0;
    if (n < bestCount) {
      best = c.value;
      bestCount = n;
    }
  }
  return best;
}

/** The darker on-tint variant for a stored hero value, if the palette has one. */
export function heroOnTint(value: string | null): string | null {
  if (!value) return null;
  return HERO_COLORS.find((c) => c.value === value)?.onTint ?? null;
}
