import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { DashboardPage } from "./DashboardPage";
import { SessionProvider } from "../lib/session";

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SessionProvider>
          <DashboardPage />
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DashboardPage", () => {
  it("renders property cards and the needs-attention feed with multiple AttentionKinds", async () => {
    renderDashboard();

    // Property cards (fixtures.ts seeds 5 properties).
    expect(await screen.findByText("Maple Street Duplex")).toBeInTheDocument();
    expect(screen.getByText("Birchwood Triplex")).toBeInTheDocument();
    expect(screen.getByText("Cedar Court Single")).toBeInTheDocument();
    expect(screen.getByText("Elm Fourplex")).toBeInTheDocument();
    expect(screen.getByText("Riverside Condo")).toBeInTheDocument();

    // Needs-attention feed renders items spanning several distinct AttentionKinds.
    expect(await screen.findByText("Work order overdue")).toBeInTheDocument();
    expect(screen.getByText("Compliance overdue")).toBeInTheDocument();
    expect(screen.getByText("Lease expiring")).toBeInTheDocument();
    expect(screen.getByText("Unit vacant")).toBeInTheDocument();
    expect(screen.getByText("Rent unpaid")).toBeInTheDocument();
  });
});
