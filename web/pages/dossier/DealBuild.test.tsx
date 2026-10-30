// web/pages/dossier/DealBuild.test.tsx — buying land and building on it.
//
// The ask: "an option in the numbers model for a property or lot bought for
// land only, with a unit built on it new — cost of building in $/sqft, land
// price — and how many units on the land are needed to make a profit, so rent
// per unit as well."
//
// prp_00000006 is the prospect fixture: $485,000 asking, $3,400/mo rent.
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../mocks/server";
import { DossierPage } from "../DossierPage";
import { DealTab } from "./DealTab";

function renderDeal(propertyId = "prp_00000006") {
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

async function setValue(user: User, label: RegExp, value: string): Promise<void> {
  const input = screen.getByLabelText(label);
  await user.clear(input);
  await user.type(input, value);
  await user.tab();
}

function unitsPanel(): HTMLElement {
  return screen.getByRole("heading", { name: /How many units it takes/ }).closest("section")!;
}

describe("land to build on", () => {
  it("is a choice on the numbers tab, and a house stays a house until it is made", async () => {
    renderDeal();
    expect(
      await screen.findByRole("button", { name: "A house", pressed: true }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "The build" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /How many units it takes/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Purchase price/)).toBeInTheDocument();
  });

  it("asks for land price, $/sq ft, unit size, units and rent per unit", async () => {
    const user = userEvent.setup();
    renderDeal();
    await user.click(await screen.findByRole("button", { name: "Land to build on" }));

    expect(screen.getByRole("heading", { name: "The build" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Land price/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Build cost per sq ft/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Size of each unit/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Units on the land/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Site work & permits/)).toBeInTheDocument();
    // The house's rent carried across as the first guess at rent per unit.
    expect(screen.getByLabelText(/^Rent per unit/)).toHaveValue("3,400");
    // Nothing to repair on a new build.
    expect(screen.queryByLabelText(/^Upfront repairs/)).not.toBeInTheDocument();
  });

  it("totals the project from the land and the build", async () => {
    const user = userEvent.setup();
    renderDeal();
    await user.click(await screen.findByRole("button", { name: "Land to build on" }));
    await setValue(user, /^Land price/, "100000");
    await setValue(user, /^Build cost per sq ft/, "250");
    await setValue(user, /^Size of each unit/, "1200");
    await setValue(user, /^Site work & permits/, "25000");
    await setValue(user, /^Units on the land/, "2");

    const build = screen.getByRole("heading", { name: "The build" }).closest("section")!;
    // $100,000 + 2 × 1,200 sq ft × $250 + $25,000.
    expect(within(build).getByText("$600,000.00")).toBeInTheDocument();
    expect(within(build).getByText("$725,000.00")).toBeInTheDocument();
    expect(within(build).getByText("$362,500.00")).toBeInTheDocument();
    expect(screen.getByText(/Rent from 2 units/)).toBeInTheDocument();
  });

  it("says how many units it takes, and picking a count plans for it", async () => {
    const user = userEvent.setup();
    renderDeal();
    await user.click(await screen.findByRole("button", { name: "Land to build on" }));
    await setValue(user, /^Land price/, "100000");
    await setValue(user, /^Rent per unit/, "3800");

    const panel = unitsPanel();
    expect(within(panel).getByText(/units? to (break even|be profitable)/)).toBeInTheDocument();
    expect(within(panel).getByText("Breaks even")).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Plan for 3 units" }));
    expect(screen.getByLabelText(/^Units on the land/)).toHaveValue("3");
    expect(
      within(unitsPanel()).getByRole("button", { name: "Plan for 3 units", pressed: true }),
    ).toBeInTheDocument();
  });

  it("says plainly when no number of units can work", async () => {
    const user = userEvent.setup();
    renderDeal();
    await user.click(await screen.findByRole("button", { name: "Land to build on" }));
    await setValue(user, /^Rent per unit/, "900");
    expect(
      within(unitsPanel()).getByText(/No number of units makes this work/),
    ).toBeInTheDocument();
  });

  it("saves the build with the analysis", async () => {
    const user = userEvent.setup();
    let sent: Record<string, unknown> | null = null;
    server.use(
      http.put("/api/properties/:propertyId/deal", async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true, data: { version: 1 } });
      }),
    );
    renderDeal("prp_00000005");
    await user.click(await screen.findByRole("button", { name: "Land to build on" }));
    await setValue(user, /^Units on the land/, "4");
    await user.click(screen.getByRole("button", { name: "Save this analysis" }));
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent).toMatchObject({ dealKind: "build", unitCount: 4 });
  });
});
