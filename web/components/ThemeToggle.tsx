import { useEffect, useState, type ReactElement } from "react";

/**
 * The handoff's daylight / evening toggle: a 38x20 track with a 14px knob that
 * slides 2px -> 20px and changes fill from --ink to ochre.
 *
 * Three states, not two. "system" is the default and stamps NO attribute, so
 * the CSS `prefers-color-scheme` block decides; an explicit choice stamps
 * data-theme and wins in both directions. That matters on a phone that flips
 * to dark on a schedule — a two-state toggle would pin you to whichever you
 * last tapped and stop following the device.
 *
 * Persisted in localStorage, wrapped because a private window or blocked site
 * data makes the accessor itself throw.
 */

type ThemeChoice = "system" | "light" | "dark";
const KEY = "keyring:theme";

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

/**
 * @param compact drop the word and show only the switch. The label is otherwise
 *   gated on the VIEWPORT being wide, which says nothing about the width of the
 *   container it lands in — in the rail that meant "EVENING" crushing the
 *   account name next to it on a perfectly wide screen.
 */
export function ThemeToggle({ compact = false }: { compact?: boolean } = {}): ReactElement {
  const [choice, setChoice] = useState<ThemeChoice>(read);

  useEffect(() => {
    apply(choice);
    try {
      if (choice === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch {
      /* storage unavailable — the choice still applies for this session */
    }
  }, [choice]);

  // What the toggle shows depends on what is actually rendered, which for
  // "system" means asking the device.
  const systemDark =
    typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = choice === "dark" || (choice === "system" && systemDark);

  return (
    <button
      type="button"
      onClick={() => setChoice(isDark ? "light" : "dark")}
      // Long-press / right-click is not discoverable, so offer "back to system"
      // in the title rather than pretending it does not exist.
      title={
        choice === "system"
          ? "Following your device. Click to pin a theme."
          : `Pinned to ${choice}. Shift-click to follow your device again.`
      }
      onMouseDown={(e) => {
        if (e.shiftKey) {
          e.preventDefault();
          setChoice("system");
        }
      }}
      aria-label={isDark ? "Switch to daylight" : "Switch to evening"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minHeight: 32,
        padding: compact ? "0 4px" : "0 4px 0 10px",
        borderRadius: 999,
        border: "1px solid var(--line)",
        background: "var(--panel)",
        color: "var(--ink-3)",
      }}
    >
      {!compact && (
        <span
          className="kr-label hidden sm:inline"
          style={{ fontSize: 9.5, letterSpacing: "0.16em" }}
        >
          {isDark ? "evening" : "daylight"}
        </span>
      )}
      <span
        aria-hidden="true"
        style={{
          position: "relative",
          width: 38,
          height: 20,
          borderRadius: 999,
          background: "var(--panel-2)",
          border: "1px solid var(--line)",
          flex: "none",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: isDark ? 20 : 2,
            width: 14,
            height: 14,
            borderRadius: 999,
            background: isDark ? "oklch(0.755 0.110 82)" : "var(--ink)",
            transition: "left 180ms ease, background 180ms ease",
          }}
        />
      </span>
    </button>
  );
}
