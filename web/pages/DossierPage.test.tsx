import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DossierPage } from "./DossierPage";
import { OverviewTab } from "./dossier/OverviewTab";
import { NotesTab } from "./dossier/NotesTab";

function renderDossier() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/p/prp_00000001/overview"]}>
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
   * The design shows five tabs; the app has eleven modules. The six without a
   * designed tab moved to a grid on Overview rather than being removed, so this
   * asserts the guarantee that actually matters — every module is still
   * reachable — rather than asserting a particular tab count.
   */
  it("keeps every module reachable, in the tab bar or on Overview", async () => {
    renderDossier();
    await screen.findByRole("heading", { name: "Maple Street Duplex" });

    const reachable = [
      // In the tab bar.
      "Overview", "Tenants", "Ledger", "Maintenance", "Papers",
      // Moved to Overview's module grid.
      "Notes", "Projects", "The particulars", "Compliance", "Turnover", "Timeline",
    ];
    for (const label of reachable) {
      // Prefix match: the module links carry a count badge, so their accessible
      // name is "Notes 3" rather than "Notes". The count belongs in the name —
      // it is real information for a screen reader, not decoration.
      expect(
        screen.getByRole("link", { name: new RegExp(`^${label}\\b`) }),
      ).toBeInTheDocument();
    }
    expect(reachable).toHaveLength(11);
  });
});
