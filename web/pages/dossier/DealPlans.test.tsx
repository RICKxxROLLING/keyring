// web/pages/dossier/DealPlans.test.tsx — plan A against plan B on the numbers tab.
//
// "See if doing a renovation to add a bedroom could be worth the extra upfront
// cost to increase rent numbers."
//
// The behaviour worth pinning is that the ONE form edits whichever plan is on
// screen: a change made on B must not leak into A, and what gets saved for B is
// the difference, not a copy. Both are invisible until they go wrong.
//
// Each test uses its own property: the mock API keeps plan B in memory for the
// life of the file.
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DossierPage } from "../DossierPage";
import { DealTab } from "./DealTab";

function renderDeal(propertyId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/p/${propertyId}/deal`]}>
        <Routes>
          <Route path="/p/:propertyId" element={<DossierPage />}>
            <Route path="deal" element={<DealTab />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

type User = ReturnType<typeof userEvent.setup>;

async function startPlanB(user: User, name = "Add a bedroom"): Promise<void> {
  await user.click(await screen.findByRole("button", { name: "+ Compare a plan B" }));
  await user.type(screen.getByLabelText("Name plan B"), name);
  await user.click(screen.getByRole("button", { name: "Start plan B" }));
}

async function setMoney(user: User, label: RegExp, dollars: string): Promise<void> {
  const input = screen.getByLabelText(label);
  await user.clear(input);
  await user.type(input, dollars);
  await user.tab();
}

function comparison(): HTMLElement {
  return screen.getByRole("region", { name: "Plan A against plan B" });
}

describe("plan B on the numbers tab", () => {
  it("offers a comparison without forcing one", async () => {
    renderDeal("prp_00000002");
    expect(await screen.findByRole("button", { name: "+ Compare a plan B" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Plan A against plan B" })).not.toBeInTheDocument();
  });

  it("starts B identical to A, and says so", async () => {
    const user = userEvent.setup();
    renderDeal("prp_00000003");
    await startPlanB(user);

    expect(screen.getByText(/Editing plan B/)).toBeInTheDocument();
    expect(within(comparison()).getByText(/identical to A so far/)).toBeInTheDocument();
  });

  it("edits B without touching A", async () => {
    const user = userEvent.setup();
    renderDeal("prp_00000004");
    await screen.findByRole("button", { name: "+ Compare a plan B" });
    const aRepairs = (screen.getByLabelText(/^Upfront repairs/) as HTMLInputElement).value;
    const aRent = (screen.getByLabelText(/^Monthly rent/) as HTMLInputElement).value;
    await startPlanB(user);

    await setMoney(user, /^Upfront repairs/, "45000");
    await setMoney(user, /^Monthly rent/, "3600");

    const changes = within(comparison());
    expect(changes.getByText("Upfront repairs")).toBeInTheDocument();
    expect(changes.getByText("$45,000.00")).toBeInTheDocument();
    expect(changes.getByText("Monthly rent")).toBeInTheDocument();
    expect(changes.getByText("$3,600.00")).toBeInTheDocument();

    // Back to A: its own numbers, untouched.
    await user.click(screen.getByRole("button", { name: /Plan A/ }));
    expect(screen.getByLabelText(/^Upfront repairs/)).toHaveValue(aRepairs);
    expect(screen.getByLabelText(/^Monthly rent/)).toHaveValue(aRent);
    expect(screen.queryByText(/Editing plan B/)).not.toBeInTheDocument();
    // And B still has its own.
    await user.click(screen.getByRole("button", { name: /Plan B/ }));
    expect(screen.getByLabelText(/^Upfront repairs/)).toHaveValue("45,000");
  });

  it("answers the question: extra cost, extra rent, and how long to repay it", async () => {
    const user = userEvent.setup();
    renderDeal("prp_00000005");
    await startPlanB(user);
    await setMoney(user, /^Upfront repairs/, "45000");
    await setMoney(user, /^Monthly rent/, "3600");

    const c = within(comparison());
    expect(c.getByText("Extra cash up front")).toBeInTheDocument();
    expect(c.getByText("Extra rent repays it in")).toBeInTheDocument();
    expect(c.getByText("Return on the extra")).toBeInTheDocument();
    // A verdict in words, not just a grid of deltas.
    expect(c.getByText(/comes out ahead|About even/)).toBeInTheDocument();
  });

  it("puts a field back to A's value on request", async () => {
    const user = userEvent.setup();
    renderDeal("prp_00000001");
    await startPlanB(user);
    await setMoney(user, /^Monthly rent/, "2500");

    await user.click(
      within(comparison()).getByRole("button", { name: "Put Monthly rent back to plan A" }),
    );
    expect(within(comparison()).getByText(/identical to A so far/)).toBeInTheDocument();
  });

  it("saves B as the fields it changes, and keeps it across a reload", async () => {
    const user = userEvent.setup();
    const first = renderDeal("prp_00000006");
    await startPlanB(user, "Fourth bedroom");
    await setMoney(user, /^Upfront repairs/, "45000");

    await user.click(screen.getByRole("button", { name: "Save both plans" }));
    await waitFor(() => expect(screen.getByText("Saved.")).toBeInTheDocument());
    first.unmount();

    renderDeal("prp_00000006");
    // Came back from the server, named, with only its one change.
    expect(await screen.findByRole("button", { name: /Fourth bedroom/ })).toBeInTheDocument();
    const c = within(comparison());
    expect(c.getByText("Upfront repairs")).toBeInTheDocument();
    expect(c.queryByText("Purchase price")).not.toBeInTheDocument();
  });
});
