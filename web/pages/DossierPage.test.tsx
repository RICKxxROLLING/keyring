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
  it("renders the quick-facts header and every module tab", async () => {
    renderDossier();

    expect(await screen.findByRole("heading", { name: "Maple Street Duplex" })).toBeInTheDocument();
    expect(screen.getByText(/occupied/)).toBeInTheDocument();

    const expectedTabs = [
      "Overview", "Notes", "Maintenance", "Projects", "Tenants",
      "Money", "Specs", "Compliance", "Turnover", "Files", "Timeline",
    ];
    for (const label of expectedTabs) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });
});
