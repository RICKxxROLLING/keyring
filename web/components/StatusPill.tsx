import type { ReactNode } from "react";
import type { Severity } from "../lib/status";

const SEVERITY_CLASS: Record<Severity, string> = {
  ok: "status-pill-ok",
  warn: "status-pill-warn",
  urgent: "status-pill-urgent",
  neutral: "status-pill-neutral",
};

/** A shape marker so severity survives colour-blindness, not just hue. */
const SEVERITY_MARK: Record<Severity, string> = {
  ok: "●", // filled circle
  warn: "▲", // triangle
  urgent: "■", // square
  neutral: "○", // hollow circle
};

export function StatusPill(props: { severity: Severity; label: string; className?: string }): JSX.Element {
  return (
    <span className={`status-pill ${SEVERITY_CLASS[props.severity]} ${props.className ?? ""}`}>
      <span aria-hidden="true">{SEVERITY_MARK[props.severity]}</span>
      {props.label}
    </span>
  );
}

export function StatusStripeCard(props: {
  severity: Severity;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  const stripeClass: Record<Severity, string> = {
    ok: "status-stripe-ok",
    warn: "status-stripe-warn",
    urgent: "status-stripe-urgent",
    neutral: "status-stripe-neutral",
  };
  return (
    <div className={`status-stripe ${stripeClass[props.severity]} ${props.className ?? ""}`}>
      {props.children}
    </div>
  );
}
