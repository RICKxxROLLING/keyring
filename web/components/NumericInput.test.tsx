// web/components/NumericInput.test.tsx
//
// These exist because the bug they cover was invisible to typechecking and to
// every test that set a value programmatically: the field only misbehaved when
// a person typed into it one character at a time.
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { MoneyInput, NumericInput } from "./NumericInput";

/** Wraps the input in the controlled-parent shape the app actually uses. */
function MoneyHarness({ onChange }: { onChange?: (c: number) => void }) {
  const [cents, setCents] = useState(0);
  return (
    <MoneyInput
      valueCents={cents}
      onChange={(c) => {
        setCents(c);
        onChange?.(c);
      }}
    />
  );
}

function PctHarness() {
  const [pct, setPct] = useState(0);
  return <NumericInput value={pct} onChange={setPct} maxFractionDigits={4} />;
}

/** Types a string one character at a time, as a person does. */
function typeInto(input: HTMLElement, text: string): void {
  fireEvent.focus(input);
  let sofar = "";
  for (const ch of text) {
    sofar += ch;
    fireEvent.change(input, { target: { value: sofar } });
  }
}

describe("MoneyInput", () => {
  it("lets a decimal point survive being typed", () => {
    const onChange = vi.fn();
    render(<MoneyHarness onChange={onChange} />);
    const input = screen.getByRole("textbox");

    typeInto(input, "1234.56");

    // The original implementation re-rendered String(value/100) on every
    // keystroke, so the trailing "." was eaten and "1234.56" was unreachable.
    expect((input as HTMLInputElement).value).toBe("1234.56");
    expect(onChange).toHaveBeenLastCalledWith(123_456);
  });

  it("keeps a trailing zero long enough to type the next digit", () => {
    render(<MoneyHarness />);
    const input = screen.getByRole("textbox");
    typeInto(input, "1.05");
    expect((input as HTMLInputElement).value).toBe("1.05");
  });

  it("groups with commas once the field loses focus", () => {
    render(<MoneyHarness />);
    const input = screen.getByRole("textbox");

    typeInto(input, "435000");
    // Unformatted while being edited, so no comma fights the caret.
    expect((input as HTMLInputElement).value).toBe("435000");

    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe("435,000");
  });

  it("drops the grouping again on focus, so typing starts clean", () => {
    render(<MoneyHarness />);
    const input = screen.getByRole("textbox");
    typeInto(input, "435000");
    fireEvent.blur(input);
    fireEvent.focus(input);
    expect((input as HTMLInputElement).value).toBe("435000");
  });

  it("accepts a pasted figure with a dollar sign and commas", () => {
    const onChange = vi.fn();
    render(<MoneyHarness onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "$1,234.56" } });
    expect(onChange).toHaveBeenLastCalledWith(123_456);
  });

  it("survives being cleared without pushing up a garbage value", () => {
    const onChange = vi.fn();
    render(<MoneyHarness onChange={onChange} />);
    const input = screen.getByRole("textbox");
    typeInto(input, "50");
    onChange.mockClear();
    fireEvent.change(input, { target: { value: "" } });
    // An empty field is mid-edit, not a value. NaN or 0 would both be wrong to
    // push up here — 0 would silently zero the deal.
    expect(onChange).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("");
  });
});

describe("NumericInput for rates", () => {
  it("accepts a four-decimal tax rate", () => {
    render(<PctHarness />);
    const input = screen.getByRole("textbox");
    // Dare County's effective rate. Rounding this to two decimals moves the
    // annual tax by hundreds of dollars.
    typeInto(input, "0.5432");
    expect((input as HTMLInputElement).value).toBe("0.5432");
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe("0.5432");
  });

  it("lets a leading decimal point be typed", () => {
    render(<PctHarness />);
    const input = screen.getByRole("textbox");
    typeInto(input, ".75");
    expect((input as HTMLInputElement).value).toBe(".75");
  });

  it("does not group a rate, which would be nonsense", () => {
    render(<PctHarness />);
    const input = screen.getByRole("textbox");
    typeInto(input, "1234.5");
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe("1234.5");
  });
});
