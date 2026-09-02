import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DossierPage } from "./DossierPage";
import { OverviewTab } from "./dossier/OverviewTab";
import { NotesTab } from "./dossier/NotesTab";

/** prp_00000001 is owned; prp_00000006 is the prospect. See mocks/fixtures. */
function renderDossier(propertyId = "prp_00000001") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/p/${propertyId}/overview`]}>
        <Routes>
          <Route path="/p/:propertyId" element={<DossierPage />}>
            <Route path="overview" element={<OverviewTab />} />
            <Route path="notes" element={<NotesTab />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DossierPage", () => {
  it("renders the hero header and the five designed tabs", async () => {
    renderDossier();

    expect(await screen.findByRole("heading", { name: "Maple Street Duplex" })).toBeInTheDocument();
    // Stat strip.
    expect(screen.getByText("Rent roll")).toBeInTheDocument();
    expect(screen.getByText("Doors filled")).toBeInTheDocument();

    for (const label of ["Overview", "Tenants", "Ledger", "Maintenance", "Papers"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  /**
   * The design shows five tabs; the app has more modules than that. The ones
   * without a designed tab moved to a grid on Overview rather than being
   * removed, so this asserts the guarantee that actually matters — every module
   * is still reachable — rather than asserting a particular tab count.
   */
  it("keeps every module reachable, in the tab bar or on Overview", async () => {
    renderDossier();
    await screen.findByRole("heading", { name: "Maple Street Duplex" });

    const reachable = [
      // In the tab bar.
      "Overview", "Tenants", "Ledger", "Maintenance", "Papers",
      // Moved to Overview's module grid.
      "Notes", "Projects", "Discussion", "Diligence",
      "The particulars", "Compliance", "Turnover", "Timeline",
    ];
    for (const label of reachable) {
      // Prefix match: the module links carry a count badge, so their accessible
      // name is "Notes 3" rather than "Notes". The count belongs in the name —
      // it is real information for a screen reader, not decoration.
      expect(
        screen.getByRole("link", { name: new RegExp(`^${label}\\b`) }),
      ).toBeInTheDocument();
    }
    expect(reachable).toHaveLength(13);
  });

  describe("a property you have not bought yet", () => {
    it("drops Tenants and Maintenance, and offers what a decision needs instead", async () => {
      renderDossier("prp_00000006");
      await screen.findByRole("heading", { name: "Wrightsville Cottage" });

      // The point of the ask: a house you do not own has neither of these, and
      // a tab that is empty by definition trains you to stop reading the bar.
      expect(screen.queryByRole("link", { name: "Tenants" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Maintenance" })).not.toBeInTheDocument();

      for (const label of ["Overview", "The numbers", "Renovation", "Diligence", "Discussion", "Ledger", "Papers"]) {
        expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
      }
    });

    it("shows numbers that mean something instead of four confident zeroes", async () => {
      renderDossier("prp_00000006");
      await screen.findByRole("heading", { name: "Wrightsville Cottage" });

      // A prospect has no rent roll and no doors filled, so those labels would
      // each be a zero presented as a fact.
      expect(screen.queryByText("Rent roll")).not.toBeInTheDocument();
      expect(screen.queryByText("Doors filled")).not.toBeInTheDocument();

      expect(screen.getByText("Renovation budget")).toBeInTheDocument();
      expect(screen.getByText("Spent so far")).toBeInTheDocument();
      expect(screen.getByText("Still to verify")).toBeInTheDocument();
      expect(screen.getByText("Likes / concerns")).toBeInTheDocument();
    });

    it("does not repeat the tab bar in Overview's module grid", async () => {
      renderDossier("prp_00000006");
      await screen.findByRole("heading", { name: "Wrightsville Cottage" });

      // Renovation, Diligence and Discussion are already tabs here. Listing
      // them again below would be a menu of things already on screen.
      expect(screen.queryByRole("link", { name: /^Projects\b/ })).not.toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: /^Discussion\b/ })).toHaveLength(1);
      expect(screen.getByRole("link", { name: /^Notes\b/ })).toBeInTheDocument();
    });
  });
});
