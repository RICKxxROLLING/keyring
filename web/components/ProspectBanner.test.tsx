// web/components/ProspectBanner.test.tsx — buying a prospect, or passing on it.
//
// The ask: "a way to remove prospective properties that i did not buy so they
// can be cleared from the list". Passing on one archives it (reversible); an
// owner can then delete it for good.
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import type { PropertyView } from "../../shared/types";
import { server } from "../mocks/server";
import * as fx from "../mocks/fixtures";
import { SessionProvider } from "../lib/session";
import { ProspectBanner } from "./ProspectBanner";

const PROSPECT = "prp_00000006";

function prospect(overrides: Partial<PropertyView> = {}): PropertyView {
  const p = fx.properties.find((x) => x.id === PROSPECT)!;
  return { ...p, ...overrides };
}

function renderBanner(property: PropertyView) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/p/${property.id}`]}>
        <SessionProvider>
          <Routes>
            <Route path="/p/:propertyId" element={<ProspectBanner property={property} />} />
            <Route path="/" element={<p>The keyring</p>} />
          </Routes>
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Records PATCH bodies sent to the prospect, answering as the real route would. */
function capturePatches(): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.patch(`/api/properties/${PROSPECT}`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return HttpResponse.json({ ok: true, data: prospect(body as Partial<PropertyView>) });
    }),
  );
  return bodies;
}

describe("ProspectBanner", () => {
  it("passing on a prospect asks first, then archives it and returns to the ring", async () => {
    const bodies = capturePatches();
    renderBanner(prospect());

    await userEvent.click(screen.getByRole("button", { name: "We passed on it" }));
    // Nothing is sent until you confirm, and the confirmation says it can come back.
    expect(bodies).toHaveLength(0);
    expect(screen.getByText(/you can put it back/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Yes, clear it" }));
    expect(await screen.findByText("The keyring")).toBeInTheDocument();
    expect(bodies).toHaveLength(1);
    expect(typeof bodies[0]!["archivedAt"]).toBe("string");
    expect(bodies[0]!["stage"]).toBeUndefined();
  });

  it("keeps it when you change your mind", async () => {
    const bodies = capturePatches();
    renderBanner(prospect());

    await userEvent.click(screen.getByRole("button", { name: "We passed on it" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.getByRole("button", { name: "I bought it" })).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });

  it("a passed prospect can be put back on the ring", async () => {
    const bodies = capturePatches();
    renderBanner(prospect({ archivedAt: "2026-10-01T12:00:00.000Z" }));

    expect(screen.getByText("Passed on")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I bought it" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Put it back on the ring" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]!["archivedAt"]).toBeNull();
  });

  it("an owner can delete a passed prospect for good, after confirming", async () => {
    let deletes = 0;
    server.use(
      http.delete(`/api/properties/${PROSPECT}`, () => {
        deletes += 1;
        return HttpResponse.json({ ok: true, data: { id: PROSPECT, deleted: true } });
      }),
    );
    renderBanner(prospect({ archivedAt: "2026-10-01T12:00:00.000Z" }));

    // The mocked session is an owner; the button waits on it loading.
    await userEvent.click(await screen.findByRole("button", { name: "Delete…" }));
    expect(screen.getByText(/can't be undone/)).toBeInTheDocument();
    expect(deletes).toBe(0);

    await userEvent.click(screen.getByRole("button", { name: "Delete it for good" }));
    expect(await screen.findByText("The keyring")).toBeInTheDocument();
    expect(deletes).toBe(1);
  });

  it("does not offer deleting to someone who is not an owner", async () => {
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({
          ok: true,
          data: {
            user: { ...fx.users[0]!, role: "manager" },
            csrfToken: "mock-csrf-token",
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            serverTime: new Date().toISOString(),
            timezone: "America/New_York",
          },
        }),
      ),
    );
    renderBanner(prospect({ archivedAt: "2026-10-01T12:00:00.000Z" }));

    expect(
      await screen.findByRole("button", { name: "Put it back on the ring" }),
    ).toBeInTheDocument();
    // Give the session a moment to load before asserting the absence.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Delete…" })).not.toBeInTheDocument(),
    );
  });
});
