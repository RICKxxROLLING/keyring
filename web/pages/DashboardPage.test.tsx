import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import * as fx from "../mocks/fixtures";
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

  it("folds prospects you passed on away under the ring, still reachable", async () => {
    const cottage = fx.properties.find((p) => p.id === "prp_00000006")!;
    server.use(
      http.get("/api/properties", () =>
        HttpResponse.json({
          ok: true,
          data: {
            items: [...fx.properties, { ...cottage, id: "prp_00000099", name: "Soundside Lot", archivedAt: "2026-10-01T12:00:00.000Z" }],
            nextCursor: null,
          },
        }),
      ),
    );
    renderDashboard();

    expect(await screen.findByText("Passed on · 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Soundside Lot/ })).toHaveAttribute("href", "/p/prp_00000099");
  });

  it("says nothing about passed prospects when there are none", async () => {
    renderDashboard();
    expect(await screen.findByText("Maple Street Duplex")).toBeInTheDocument();
    expect(screen.queryByText(/^Passed on/)).not.toBeInTheDocument();
  });
});
