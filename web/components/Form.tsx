import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const fieldClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 " +
  "placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100";

export function Field(props: { label: string; htmlFor?: string; hint?: string; error?: string; children: ReactNode }): JSX.Element {
  return (
    <label className="mb-3 block" htmlFor={props.htmlFor}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{props.label}</span>
      {props.children}
      {props.hint && !props.error && <span className="mt-1 block text-xs text-slate-500">{props.hint}</span>}
      {props.error && <span className="mt-1 block text-xs font-medium text-red-600">{props.error}</span>}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return <input {...props} className={`${fieldClass} ${props.className ?? ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return <textarea {...props} className={`${fieldClass} min-h-24 resize-y ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return <select {...props} className={`${fieldClass} ${props.className ?? ""}`} />;
}

export function EmptyState(props: { title: string; detail?: string; action?: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="font-semibold text-slate-700">{props.title}</p>
      {props.detail && <p className="text-sm text-slate-500">{props.detail}</p>}
      {props.action}
    </div>
  );
}

export function Spinner(props: { label?: string }): JSX.Element {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" aria-hidden="true" />
      {props.label ?? "Loading…"}
    </div>
  );
}

export function ErrorNotice(props: { message: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">
      {props.message}
    </div>
  );
}
