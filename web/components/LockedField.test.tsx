import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LockedTextArea } from "./LockedField";

vi.mock("../lib/realtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/realtime")>();
  return {
    ...actual,
    useFieldLock: () => ({
      status: "denied" as const,
      holder: { id: "usr_2", handle: "dana", displayName: "Dana Marsh", avatarColor: "#16a34a" },
      canTakeoverAt: null,
      remoteDraft: "Dana is typing this right now…",
      acquire: () => {},
      release: () => {},
      takeover: () => {},
      sendDraft: () => {},
    }),
  };
});

function renderLocked() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LockedTextArea entityType="note" entityId="not_1" field="body" value="my saved copy" onChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe("LockedTextArea", () => {
  it("renders read-only with the remote draft and an 'is editing…' indicator when denied", () => {
    renderLocked();

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea).toHaveValue("Dana is typing this right now…");
    expect(textarea).toHaveAttribute("readonly");
    expect(screen.getByText(/Dana Marsh is editing…/)).toBeInTheDocument();
  });
});
