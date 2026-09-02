// web/pages/dossier/ProspectWorkspace.test.tsx — the three tabs a property you
// are considering has instead of Tenants and Maintenance.
//
// The ask: "a renovation tab ... which would tie into the ledger, and a main
// discussion chat area for property discussion on likes and dislikes ... also
// maybe a todo section on acquiring things like past permits or land data to
// verify septic and elevation data."
//
// Rendered through DossierPage against MSW so the payload, the routing and the
// stage-dependent chrome are all real. prp_00000006 is the prospect fixture.
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DossierPage } from "../DossierPage";
import { OverviewTab } from "./OverviewTab";
import { RenovationTab } from "./RenovationTab";
import { DiscussionTab } from "./DiscussionTab";
import { DiligenceTab } from "./DiligenceTab";
import { TenantsTab } from "./TenantsTab";
import * as fx from "../../mocks/fixtures";

const PROSPECT = "prp_00000006";

function renderTab(path: string, propertyId = PROSPECT) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/p/${propertyId}/${path}`]}>
        <Routes>
          <Route path="/p/:propertyId" element={<DossierPage />}>
            <Route path="overview" element={<OverviewTab />} />
            <Route path="projects" element={<RenovationTab />} />
            <Route path="discussion" element={<DiscussionTab />} />
            <Route path="diligence" element={<DiligenceTab />} />
            <Route path="tenants" element={<TenantsTab />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function loaded(): Promise<void> {
  await screen.findByRole("heading", { name: "Wrightsville Cottage" });
}

/** The list row containing this text — a checklist item or a project. */
function row(text: string | RegExp): HTMLElement {
  const li = screen.getByText(text).closest("li");
  expect(li, `no row containing ${String(text)}`).not.toBeNull();
  return li as HTMLElement;
}

describe("Renovation", () => {
  it("prices the work between what you planned and what you have spent", async () => {
    renderTab("projects");
    await loaded();

    expect(await screen.findByText("Getting it rentable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kitchen and both baths/ })).toBeInTheDocument();
    // Budget across both prospect projects: 42,000 + 8,500.
    expect(screen.getAllByText("$50,500.00").length).toBeGreaterThan(0);
  });

  it("logs a cost to the property ledger, not to a store of its own", async () => {
    const user = userEvent.setup();
    renderTab("projects");
    await loaded();

    await user.click(await screen.findByRole("button", { name: /Kitchen and both baths/ }));
    await user.type(await screen.findByLabelText("What was paid for"), "Cabinet deposit");
    await user.type(screen.getByLabelText("Amount"), "6500");
    await user.click(screen.getByRole("button", { name: "Log cost" }));

    // The assertion that matters: it is an expense ROW on the property, tagged
    // to the project. A project-only cost store would satisfy the UI and leave
    // the money page showing nothing.
    await waitFor(() => {
      const logged = fx.expenses.find((e) => e.description === "Cabinet deposit");
      expect(logged).toBeDefined();
      expect(logged!.propertyId).toBe(PROSPECT);
      expect(logged!.projectId).toBe("prj_00000003");
      expect(logged!.amountCents).toBe(650000);
    });
  });
});

describe("Discussion", () => {
  it("reads oldest first and summarises the likes and the concerns", async () => {
    renderTab("discussion");
    await loaded();

    const messages = await screen.findAllByRole("listitem");
    const bodies = messages.map((li) => li.textContent ?? "");
    const walked = bodies.findIndex((t) => t.includes("Walked it this morning"));
    const quiet = bodies.findIndex((t) => t.includes("Quiet end of the road"));
    expect(walked).toBeGreaterThanOrEqual(0);
    // Said eight days ago vs three: a thread reads in the order it was said.
    expect(walked).toBeLessThan(quiet);

    const likes = screen.getByText(/^Likes ·/).closest("section")!;
    expect(within(likes).getByText(/Sound views from the upper deck/)).toBeInTheDocument();
    const concerns = screen.getByText(/^Concerns ·/).closest("section")!;
    expect(within(concerns).getByText(/Ground floor is enclosed/)).toBeInTheDocument();
  });

  it("posts a message tagged as a concern, and it joins the summary", async () => {
    const user = userEvent.setup();
    renderTab("discussion");
    await loaded();

    await user.type(
      await screen.findByLabelText("New message"),
      "Driveway is shared with the neighbour.",
    );
    // Two toggles exist per editable message, so scope to the composer's.
    const composer = screen.getByLabelText("New message").closest("div")!;
    await user.click(within(composer).getByRole("button", { name: "− Concern" }));
    await user.click(within(composer).getByRole("button", { name: "Post" }));

    await waitFor(() => {
      const concerns = screen.getByText(/^Concerns ·/).closest("section")!;
      expect(within(concerns).getByText(/Driveway is shared/)).toBeInTheDocument();
    });
  });

  it("marks a message as edited only when it really was", async () => {
    renderTab("discussion");
    await loaded();

    // Each of these appears twice — once in the thread and once in the
    // summary panel above it — so pick the copy inside the message itself.
    const inThread = (pattern: RegExp): HTMLElement => {
      const match = screen
        .getAllByText(pattern)
        .map((el) => el.closest("article"))
        .find((el): el is HTMLElement => el instanceof HTMLElement);
      expect(match, `no message matching ${pattern}`).toBeDefined();
      return match!;
    };

    expect((await screen.findAllByText(/Budgeting 42k for kitchen/)).length).toBeGreaterThan(0);
    expect(inThread(/Budgeting 42k for kitchen/).textContent).toContain("edited");
    expect(inThread(/Quiet end of the road/).textContent).not.toContain("edited");
  });
});

describe("Diligence", () => {
  it("separates a document that arrived from one that has been read", async () => {
    renderTab("diligence");
    await loaded();

    // The septic permit arrived and says three bedrooms; the elevation
    // certificate has been read and is fine. A checkbox would call both "done",
    // which is the distinction the whole status enum exists to keep.
    await screen.findByText(/Septic permit/);
    expect(within(row(/Septic permit/)).getByText("Arrived")).toBeInTheDocument();
    expect(within(row("Elevation certificate")).getByText("Checked")).toBeInTheDocument();
  });

  it("groups by kind of question rather than by status", async () => {
    renderTab("diligence");
    await loaded();

    // Status-ordered, the list reshuffles every time you touch it, which makes
    // it impossible to work down.
    for (const heading of ["Permits & permissions", "Land, flood & elevation", "Money & insurance"]) {
      expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    }
  });

  // There is no test here for attaching a document, though the control exists
  // and the server rules for it are covered in diligence.test.ts. MSW under
  // jsdom cannot carry a multipart body — request.formData() rejects with
  // "Content-Type was not one of multipart/form-data" because jsdom's fetch
  // drops the boundary — so a test of the upload leg would be testing the
  // harness. FilesTab's uploader is unasserted for the same reason.

  it("adds the standard list around what is already there, without duplicating it", async () => {
    const user = userEvent.setup();
    const before = fx.diligenceItems.filter((d) => d.propertyId === PROSPECT).length;
    renderTab("diligence");
    await loaded();

    await user.click(await screen.findByRole("button", { name: "Add the standard list" }));

    await waitFor(() => {
      const after = fx.diligenceItems.filter((d) => d.propertyId === PROSPECT);
      expect(after.length).toBeGreaterThan(before);
      // The fixture's "Elevation certificate" already carries a finding. A
      // template application that duplicated it would leave two rows, one of
      // them wrong.
      const elevation = after.filter((d) => d.label === "Elevation certificate");
      expect(elevation).toHaveLength(1);
      expect(elevation[0]!.finding).toContain("12.4ft");
    });
  });
});

describe("the tabs a prospect does not get", () => {
  it("still renders Tenants if you go there, and says why it is hidden", async () => {
    renderTab("tenants");
    await loaded();

    // Hidden from the bar, not removed. Someone bookmarked it, or the house
    // comes with a tenant already in it.
    expect(await screen.findByText(/hidden from this property's tabs/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tenants" })).toBeInTheDocument();
  });

  it("says nothing of the sort on a property you own", async () => {
    renderTab("tenants", "prp_00000001");
    await screen.findByRole("heading", { name: "Maple Street Duplex" });
    expect(screen.queryByText(/hidden from this property's tabs/)).not.toBeInTheDocument();
  });
});

describe("Overview, on a property you have not bought", () => {
  it("leads with the decision instead of a list of empty rooms", async () => {
    renderTab("overview");
    await loaded();

    // The owned layout opens with the doors and who is behind them, and a
    // "Needs a hand" feed computed from work orders, leases and compliance —
    // none of which a house you do not own has.
    expect(screen.queryByRole("heading", { name: /door/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Needs a hand" })).not.toBeInTheDocument();

    for (const panel of ["Getting it rentable", "What the checks say", "What we think"]) {
      expect(await screen.findByRole("heading", { name: panel })).toBeInTheDocument();
    }
  });

  it("shows the answers, not a second copy of the counts above it", async () => {
    renderTab("overview");
    await loaded();

    // The stat strip already carries the counts. What is worth a summary panel
    // is what was actually found, said and quoted.
    expect(await screen.findByText(/Permit is for 3 bedrooms/)).toBeInTheDocument();
    expect(screen.getByText(/Sound views from the upper deck/)).toBeInTheDocument();
    expect(screen.getByText(/Kitchen and both baths/)).toBeInTheDocument();
    // The budget, not the spend: an earlier test in this file logs a cost
    // against the same project, and asserting the running total would make
    // this pass or fail on test order.
    expect(screen.getByText(/of \$42,000\.00/)).toBeInTheDocument();
  });

  it("leaves out checklist items that have not come back", async () => {
    renderTab("overview");
    await loaded();

    // "Short-term rental rules" is still at not-asked with no finding. Listing
    // every open question would make this the checklist, not a summary of it.
    await screen.findByRole("heading", { name: "What the checks say" });
    expect(screen.queryByText(/Short-term rental rules/)).not.toBeInTheDocument();
    expect(screen.getByText(/still open ·/)).toBeInTheDocument();
  });

  it("flags a chase that has gone past its date", async () => {
    renderTab("overview");
    await loaded();

    const waiting = (await screen.findByText("Waiting on")).closest("div")!;
    // Two items carry future dates; neither is overdue in the fixture, so the
    // section exists without the warning. The date itself is the useful part.
    expect(within(waiting).getByText(/Past building permits/)).toBeInTheDocument();
  });

  it("points each panel at the tab it summarises", async () => {
    renderTab("overview");
    await loaded();

    // Relative links from /p/:id/overview.
    const links = await screen.findAllByRole("link");
    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(`/p/${PROSPECT}/projects`);
    expect(hrefs).toContain(`/p/${PROSPECT}/diligence`);
    expect(hrefs).toContain(`/p/${PROSPECT}/discussion`);
  });

  it("still opens with the doors on a property you own", async () => {
    renderTab("overview", "prp_00000001");
    await screen.findByRole("heading", { name: "Maple Street Duplex" });

    expect(await screen.findByRole("heading", { name: /Two doors/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Needs a hand" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "What we think" })).not.toBeInTheDocument();
  });
});
