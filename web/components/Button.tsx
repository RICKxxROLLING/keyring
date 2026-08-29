import type { ButtonHTMLAttributes } from "react";
import { useOnlineStatus } from "../lib/offline";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-600",
  secondary: "bg-white text-slate-900 border border-slate-300 hover:bg-slate-50",
  danger: "bg-white text-red-700 border border-red-300 hover:bg-red-50",
  ghost: "bg-transparent text-slate-700 hover:bg-slate-100",
};

/**
 * Write-triggering variants (primary/danger) auto-disable while `navigator.onLine` is false, so
 * no create/save/delete action can be started offline — per design §C10.7, there is no write
 * queue and no offline mutation. Pass `allowOffline` to opt a specific button out (navigational
 * "Back"/"Cancel" actions built on `primary` styling, if any).
 */
export function Button({
  variant = "primary",
  className = "",
  disabled,
  allowOffline,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; allowOffline?: boolean }): JSX.Element {
  const online = useOnlineStatus();
  const offlineBlocked = !allowOffline && !online && (variant === "primary" || variant === "danger");
  return (
    <button
      {...rest}
      disabled={disabled || offlineBlocked}
      title={offlineBlocked ? "You're offline — this action is unavailable until you're back online." : rest.title}
      className={`tap-target inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold
        transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2
        focus-visible:outline-offset-2 ${VARIANT_CLASS[variant]} ${className}`}
    />
  );
}

export function IconButton({
  className = "",
  label,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }): JSX.Element {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={`tap-target inline-flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${className}`}
    />
  );
}
