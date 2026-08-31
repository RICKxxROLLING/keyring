import type { ReactElement, ReactNode } from "react";
import { KeyGlyph } from "./KeyGlyph";
import { ThemeToggle } from "./ThemeToggle";
import { HERO_COLORS } from "../../shared/hero-colors";

/**
 * The chrome every unauthenticated screen shares: setup, login, invite accept.
 *
 * These sit outside AppShell, so they had kept the pre-Keyring palette — which
 * meant the first thing anyone ever saw was the one screen the design language
 * had not reached.
 *
 * The keys along the top are the only decorative flourish in the app. They earn
 * their place here specifically because this is the one screen with no real
 * keyring to show: you have not signed in, so there is no portfolio yet. They
 * are the palette itself, which is also a quiet preview of what the ring looks
 * like once you have one.
 */
export function AuthLayout(props: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Setup and invite-accept are wider: QR codes and recovery-code grids. */
  wide?: boolean;
  footer?: ReactNode;
}): ReactElement {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        padding: "clamp(16px, 5vw, 48px) clamp(12px, 4vw, 32px)",
        background: "var(--bg)",
      }}
    >
      <div style={{ position: "absolute", top: 16, right: 16 }}>
        <ThemeToggle />
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: props.wide ? 560 : 420,
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 20,
          boxShadow: "var(--shadow)",
          padding: "clamp(20px, 4vw, 30px)",
        }}
      >
        {/* The ring, as a row of keys — the palette, and a preview of what you
            are signing in to. Decorative, so hidden from assistive tech. */}
        <div aria-hidden="true" style={{ display: "flex", gap: 2, marginBottom: 18 }}>
          {HERO_COLORS.map((c) => (
            <KeyGlyph key={c.id} color={c.value} size="card" />
          ))}
        </div>

        <h1
          className="kr-display"
          style={{
            margin: 0,
            fontSize: "clamp(1.5rem, 1.2rem + 1.2vw, 1.9rem)",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
          }}
        >
          {props.title}
        </h1>
        {props.subtitle && (
          <p
            style={{
              margin: "8px 0 22px",
              fontSize: 14.5,
              lineHeight: 1.5,
              color: "var(--ink-2)",
              textWrap: "pretty",
            }}
          >
            {props.subtitle}
          </p>
        )}
        {!props.subtitle && <div style={{ height: 18 }} />}

        {props.children}
      </div>

      {props.footer && (
        <div style={{ maxWidth: 420, textAlign: "center", fontSize: 13, color: "var(--ink-3)" }}>
          {props.footer}
        </div>
      )}
    </div>
  );
}
