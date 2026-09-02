import { useState, type ReactElement } from "react";
import { TextInput } from "./Form";

/**
 * A number field you can actually type in.
 *
 * The obvious implementation — `value={String(n)}` with an onChange that parses
 * — cannot accept a decimal point. Type "435000." and it parses to 435000,
 * re-renders as "435000", and eats the dot on every keystroke. The same applies
 * to a leading "." and to "1.0", where the trailing zero vanishes before you
 * can type the digit after it.
 *
 * So while the field has focus it shows exactly what you typed, and the parsed
 * value is pushed up on each keystroke that parses. On blur the draft is
 * dropped and the formatted value takes over — which is where the thousands
 * separators appear.
 *
 * Grouping only when unfocused is deliberate. Formatting mid-typing means
 * moving the caret every time a separator is inserted or removed, and getting
 * that wrong is far more annoying than reading an unformatted number for the
 * few seconds you are editing it.
 */
export function NumericInput(props: {
  value: number;
  onChange: (value: number) => void;
  /** Thousands separators when not being edited. */
  group?: boolean;
  /** Digits kept when formatting. Money wants 2; a rate wants 4. */
  maxFractionDigits?: number;
  /** Values below this are ignored rather than pushed up. */
  min?: number;
  suffix?: string;
  placeholder?: string;
  autoFocus?: boolean;
}): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);

  const formatted = format(props.value, props.group ?? false, props.maxFractionDigits ?? 2);

  return (
    <TextInput
      inputMode="decimal"
      autoFocus={props.autoFocus}
      placeholder={props.placeholder}
      value={draft ?? formatted}
      onFocus={() => setDraft(plain(props.value, props.maxFractionDigits ?? 2))}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        const typed = e.target.value;
        setDraft(typed);

        // Strip what people paste in from a listing or a receipt.
        const cleaned = typed.replace(/[$,\s%]/g, "");
        if (cleaned === "" || cleaned === "-") return;
        const n = Number(cleaned);
        if (!Number.isFinite(n)) return;
        if (props.min !== undefined && n < props.min) return;
        props.onChange(n);
      }}
    />
  );
}

/**
 * Money in cents, edited in dollars.
 *
 * The conversion lives here rather than at every call site, because doing it
 * inline is how a factor of 100 eventually goes missing in one place.
 */
export function MoneyInput(props: {
  valueCents: number;
  onChange: (cents: number) => void;
  placeholder?: string;
  autoFocus?: boolean;
}): ReactElement {
  return (
    <NumericInput
      value={props.valueCents / 100}
      onChange={(dollars) => props.onChange(Math.round(dollars * 100))}
      group
      maxFractionDigits={2}
      min={0}
      placeholder={props.placeholder}
      autoFocus={props.autoFocus}
    />
  );
}

/** What the field shows when it is not being edited. */
function format(value: number, group: boolean, maxFractionDigits: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("en-US", {
    useGrouping: group,
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
}

/**
 * What the field shows the moment it gains focus.
 *
 * Ungrouped, so the first keystroke does not have to fight a comma, and
 * rounded to the same precision as the display so focusing a field cannot
 * silently reveal floating-point noise like 0.30000000000000004.
 */
function plain(value: number, maxFractionDigits: number): string {
  if (!Number.isFinite(value)) return "";
  const rounded = Number(value.toFixed(maxFractionDigits));
  return String(rounded);
}
