import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VersionConflictDialog } from "./VersionConflictDialog";

describe("VersionConflictDialog", () => {
  it("renders both the user's draft and the server's current copy, and calls the right handler for each choice", async () => {
    const user = userEvent.setup();
    const onKeepMine = vi.fn();
    const onTakeTheirs = vi.fn();

    render(
      <VersionConflictDialog
        open
        onClose={() => {}}
        fieldLabel="note"
        yourValue="my draft text"
        serverValue="Dana's saved text"
        changedBy="Dana Marsh"
        onKeepMine={onKeepMine}
        onTakeTheirs={onTakeTheirs}
      />,
    );

    expect(screen.getByText("my draft text")).toBeInTheDocument();
    expect(screen.getByText("Dana's saved text")).toBeInTheDocument();
    expect(screen.getByText(/Dana Marsh changed/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Keep mine" }));
    expect(onKeepMine).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Take theirs" }));
    expect(onTakeTheirs).toHaveBeenCalledTimes(1);
  });
});
