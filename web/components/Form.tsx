import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, ReactElement } from "react";

/** Tokenised in web/styles/tokens.css so every input follows the theme. */
const fieldClass = "kr-input";

export function Field(props: { label: string; htmlFor?: string; hint?: string; error?: string; children: ReactNode }): ReactElement {
  return (
    <label className="mb-3 block" htmlFor={props.htmlFor}>
      <span className="kr-field-label">{props.label}</span>
      {props.children}
      {props.hint && !props.error && <span className="kr-field-hint">{props.hint}</span>}
      {props.error && <span className="mt-1 block text-xs font-medium text-red-600">{props.error}</span>}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>): ReactElement {
  return <input {...props} className={`${fieldClass} ${props.className ?? ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactElement {
  return <textarea {...props} className={`${fieldClass} min-h-24 resize-y ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>): ReactElement {
  return <select {...props} className={`${fieldClass} ${props.className ?? ""}`} />;
}

export function EmptyState(props: { title: string; detail?: string; action?: ReactNode }): ReactElement {
  return (
    <div className="kr-empty">
      <p className="kr-display" style={{ fontSize: 17 }}>{props.title}</p>
      {props.detail && <p className="text-sm" style={{ color: "var(--ink-3)" }}>{props.detail}</p>}
      {props.action}
    </div>
  );
}

export function Spinner(props: { label?: string }): ReactElement {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm" style={{ color: "var(--ink-3)" }} role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: "var(--line)", borderTopColor: "var(--ink)" }} aria-hidden="true" />
      {props.label ?? "Loading…"}
    </div>
  );
}

export function ErrorNotice(props: { message: string }): ReactElement {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">
      {props.message}
    </div>
  );
}
