// web/components/ExpandableRow.test.tsx — the row that opens in place.
//
// Animating its height meant the panel can no longer be unmounted when closed:
// there has to be content to collapse, or the row snaps shut and the height
// transition plays against an empty box. That trade buys the animation but
// introduces two ways to get it wrong, and both are invisible on screen:
//
//   - render every panel up front, and a list of forty rows renders forty
//     panels nobody asked for;
//   - leave the closed panel in the accessibility tree, and you can tab into
//     content that is not visible.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExpandableRow } from "./ExpandableRow";

function renderRow(defaultOpen = false) {
  return render(
    <ExpandableRow label="Expense: Cabinets" summary={<span>Cabinets</span>} defaultOpen={defaultOpen}>
      <p>Paid by card ending 4471</p>
    </ExpandableRow>,
  );
}

describe("ExpandableRow", () => {
  it("renders nothing inside a row nobody has opened", () => {
    renderRow();
    // The whole point of a collapsed row. Forty of these on the Ledger tab
    // would otherwise each render a detail panel on first paint.
    expect(screen.queryByText("Paid by card ending 4471")).not.toBeInTheDocument();
  });

  it("keeps the panel mounted once opened, so closing has something to collapse", async () => {
    const user = userEvent.setup();
    renderRow();
    const toggle = screen.getByRole("button", { name: /Expense: Cabinets/ });

    await user.click(toggle);
    expect(screen.getByText("Paid by card ending 4471")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Still in the DOM at zero height — that is what the transition animates.
    expect(screen.getByText("Paid by card ending 4471")).toBeInTheDocument();
  });

  it("takes the closed panel out of reach", async () => {
    const user = userEvent.setup();
    renderRow(true);
    const region = screen.getByText("Paid by card ending 4471").closest("[data-open]")!;
    expect(region).toHaveAttribute("data-open", "true");
    expect(region).not.toHaveAttribute("inert");

    await user.click(screen.getByRole("button", { name: /Expense: Cabinets/ }));

    // inert, not just height 0: without it the content is invisible but still
    // focusable and still read aloud, which is worse than either state alone.
    expect(region).toHaveAttribute("data-open", "false");
    expect(region).toHaveAttribute("inert");
  });

  it("opens already expanded when a deep link names it", () => {
    renderRow(true);
    expect(screen.getByText("Paid by card ending 4471")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Expense: Cabinets/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
