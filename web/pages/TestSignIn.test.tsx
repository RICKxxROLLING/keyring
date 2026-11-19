// web/pages/TestSignIn.test.tsx — one-click test accounts, only where the server offers them.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import { TestSignIn } from "./TestSignIn";

function renderPicker(onSignedIn = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TestSignIn onSignedIn={onSignedIn} />
    </QueryClientProvider>,
  );
  return onSignedIn;
}

const okJson = (data: unknown) => HttpResponse.json({ ok: true, data });

describe("test sign-in picker", () => {
  it("lists the test accounts and signs in as the one picked", async () => {
    server.use(
      http.get("/api/instance", () => okJson({ instance: "test", testSignIn: true })),
      http.get("/api/test/accounts", () =>
        okJson([
          { id: "usr_owner", displayName: "Test Owner", role: "owner" },
          { id: "usr_a", displayName: "Test Manager A", role: "manager" },
        ]),
      ),
      http.post("/api/test/sign-in", async ({ request }) => {
        const body = (await request.json()) as { userId: string };
        return okJson({ user: { id: body.userId }, csrfToken: "c", expiresAt: "x" });
      }),
    );
    const onSignedIn = renderPicker();
    await userEvent.click(await screen.findByRole("button", { name: "Test Manager A · manager" }));
    expect(onSignedIn).toHaveBeenCalledWith(expect.objectContaining({ user: { id: "usr_a" } }));
  });

  it("is absent when the server does not offer it", async () => {
    server.use(http.get("/api/instance", () => okJson({ instance: null, testSignIn: false })));
    renderPicker();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("region", { name: "Test accounts" })).not.toBeInTheDocument();
  });
});
