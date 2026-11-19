// web/components/InstanceBanner.test.tsx — the test server says so; production says nothing.
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import { InstanceBanner } from "./InstanceBanner";

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <InstanceBanner />
    </QueryClientProvider>,
  );
}

const answer = (instance: string | null) =>
  server.use(http.get("/api/instance", () => HttpResponse.json({ ok: true, data: { instance } })));

// index.html's title; jsdom starts with none.
beforeEach(() => {
  document.title = "Keyring";
});

describe("instance banner", () => {
  it("marks the test server, and its tab", async () => {
    answer("test");
    renderBanner();
    expect(await screen.findByRole("note", { name: "test server" })).toHaveTextContent(
      /nothing here reaches the real Keyring/,
    );
    expect(document.title).toBe("[TEST] Keyring");
  });

  it("shows nothing in production", async () => {
    answer(null);
    const { container } = renderBanner();
    await new Promise((r) => setTimeout(r, 30));
    expect(container).toBeEmptyDOMElement();
    expect(document.title).toBe("Keyring");
  });

  it("shows nothing if the question cannot be answered", async () => {
    server.use(http.get("/api/instance", () => HttpResponse.error()));
    const { container } = renderBanner();
    await new Promise((r) => setTimeout(r, 30));
    expect(container).toBeEmptyDOMElement();
  });
});
