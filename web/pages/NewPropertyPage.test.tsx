// web/pages/NewPropertyPage.test.tsx — cutting a key.
//
// The screen is called "Cut a new key" and KeyGlyph is four positioned
// primitives rather than an imported SVG, so the key can actually be drawn:
// bow, shaft, then the two teeth. Finishing shows that before the dossier
// opens.
//
// It is the one place in the app that deliberately delays a navigation, which
// makes it the one place a delight animation could become an obstacle. Both
// tests here are about that: it must arrive, and it must get out of the way —
// immediately, for anyone who has asked for less motion.
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { NewPropertyPage } from "./NewPropertyPage";

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/properties/new"]}>
        <Routes>
          <Route path="/properties/new" element={<NewPropertyPage />} />
          <Route path="/p/:propertyId" element={<p>the dossier</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fillAndSubmit(): Promise<void> {
  const user = userEvent.setup();
  // Field wraps its input in the <label>, so the accessible name carries the
  // hint text too — hence the anchored regexes rather than exact strings.
  await user.type(screen.getByLabelText(/^Name/), "Wrightsville Cottage");
  await user.type(screen.getByLabelText(/^Street address/), "812 W Soundside Rd");
  await user.type(screen.getByLabelText(/^City/), "Nags Head");
  await user.type(screen.getByLabelText(/^State/), "NC");
  await user.type(screen.getByLabelText(/^ZIP/), "27959");
  await user.click(screen.getByRole("button", { name: "Cut the key" }));
}

/** jsdom's matchMedia is stubbed to "no preference"; this flips one query. */
function setReducedMotion(on: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: on && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe("cutting a key", () => {
  afterEach(() => setReducedMotion(false));

  it("shows the key being cut, then opens the property", async () => {
    setReducedMotion(false);
    renderPage();
    await fillAndSubmit();

    // The moment: the name it was cut for, and nothing else to read.
    expect(await screen.findByText("Wrightsville Cottage")).toBeInTheDocument();
    expect(screen.queryByText("the dossier")).not.toBeInTheDocument();

    // And then it gets out of the way on its own — no click required.
    await waitFor(() => expect(screen.getByText("the dossier")).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it("goes straight through when the person asked for less motion", async () => {
    setReducedMotion(true);
    renderPage();
    await fillAndSubmit();

    // No pause at all. Reduced motion is not "the same animation, faster" —
    // a delay whose only purpose is to let an animation play is motion too.
    await waitFor(() => expect(screen.getByText("the dossier")).toBeInTheDocument());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
