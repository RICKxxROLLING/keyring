// web/lib/change-pulse.test.ts — "somebody else just changed this".
//
// The rule that matters is the one about whose change it was. A wash on every
// change, including your own, is not information: it fires on every save you
// make and reads as an error state until you learn to ignore it — at which
// point it has stopped working for the case it was built for.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "../../shared/realtime";
import type { UserRef } from "../../shared/types";
import { changePulses, PULSE_MS } from "./change-pulse";

const ME: UserRef = {
  id: "usr_me",
  handle: "riley",
  displayName: "Riley",
  avatarColor: "#2563eb",
};
const SAM: UserRef = {
  id: "usr_sam",
  handle: "sam",
  displayName: "Sam",
  avatarColor: "#d97706",
};

function ready(user: UserRef): ServerMessage {
  return { t: "ready", v: 1, connId: "c1", user, serverTime: new Date().toISOString() };
}

function presence(users: UserRef[]): ServerMessage {
  return {
    t: "presence",
    channel: "property:prp_1",
    users: users.map((user) => ({
      connId: `c_${user.id}`,
      user,
      page: null,
      status: "active" as const,
      since: new Date().toISOString(),
    })),
  };
}

function changed(entityId: string, actorId: string | null): ServerMessage {
  return {
    t: "entity",
    channel: "property:prp_1",
    action: "updated",
    entityType: "work_order",
    entityId,
    propertyId: "prp_1",
    version: 2,
    actorId,
    at: new Date().toISOString(),
  };
}

/** Nothing reads the store until something subscribes; this stands in for a row. */
function watch(): () => void {
  return changePulses.subscribe(() => {});
}

describe("change pulses", () => {
  let unwatch: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    unwatch = watch();
    changePulses.reset();
  });

  afterEach(() => {
    unwatch?.();
    unwatch = null;
    vi.useRealTimers();
  });

  it("washes a row someone else changed, in that person's colour", () => {
    changePulses.ingest(ready(ME));
    changePulses.ingest(presence([ME, SAM]));
    changePulses.ingest(changed("wo_1", SAM.id));

    expect(changePulses.colorFor("work_order", "wo_1")).toBe(SAM.avatarColor);
  });

  it("says nothing about your own writes", () => {
    changePulses.ingest(ready(ME));
    changePulses.ingest(presence([ME, SAM]));
    changePulses.ingest(changed("wo_1", ME.id));

    // Every save flashing the row you just edited is not feedback, it is noise
    // you learn to filter — and then you filter the useful case with it.
    expect(changePulses.colorFor("work_order", "wo_1")).toBeNull();
  });

  it("still washes when the actor is nobody it has a colour for", () => {
    changePulses.ingest(ready(ME));
    // No presence frame: someone acting from a page this client never shared.
    changePulses.ingest(changed("wo_1", "usr_stranger"));

    // A neutral wash is right. Silence would mean "nothing happened", which is
    // false, and inventing a colour would attribute the change to the wrong
    // person.
    expect(changePulses.colorFor("work_order", "wo_1")).toBe("var(--ink-3)");
  });

  it("ignores a change with no actor at all", () => {
    changePulses.ingest(ready(ME));
    changePulses.ingest(changed("wo_1", null));
    // Server-generated writes — the PM job creating work orders overnight —
    // are not somebody looking at the same screen as you.
    expect(changePulses.colorFor("work_order", "wo_1")).toBeNull();
  });

  it("fades out on its own", () => {
    changePulses.ingest(ready(ME));
    changePulses.ingest(presence([SAM]));
    changePulses.ingest(changed("wo_1", SAM.id));
    expect(changePulses.colorFor("work_order", "wo_1")).toBe(SAM.avatarColor);

    vi.advanceTimersByTime(PULSE_MS - 1);
    expect(changePulses.colorFor("work_order", "wo_1")).toBe(SAM.avatarColor);

    vi.advanceTimersByTime(2);
    expect(changePulses.colorFor("work_order", "wo_1")).toBeNull();
  });

  it("extends the wash when a second change lands mid-fade", () => {
    changePulses.ingest(ready(ME));
    changePulses.ingest(presence([SAM]));
    changePulses.ingest(changed("wo_1", SAM.id));

    vi.advanceTimersByTime(PULSE_MS - 100);
    changePulses.ingest(changed("wo_1", SAM.id));

    // The original timer must have been cleared. Left in place it would clear
    // the row 100ms into the second wash.
    vi.advanceTimersByTime(200);
    expect(changePulses.colorFor("work_order", "wo_1")).toBe(SAM.avatarColor);

    vi.advanceTimersByTime(PULSE_MS);
    expect(changePulses.colorFor("work_order", "wo_1")).toBeNull();
  });

  it("keeps rows apart", () => {
    changePulses.ingest(ready(ME));
    changePulses.ingest(presence([SAM]));
    changePulses.ingest(changed("wo_1", SAM.id));

    expect(changePulses.colorFor("work_order", "wo_2")).toBeNull();
    // Same id, different kind of row — the key is the pair, not the id.
    expect(changePulses.colorFor("project", "wo_1")).toBeNull();
  });

  it("notifies subscribers when a wash starts and when it ends", () => {
    const seen = vi.fn();
    const stop = changePulses.subscribe(seen);
    changePulses.ingest(ready(ME));
    changePulses.ingest(changed("wo_1", SAM.id));
    expect(seen).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(PULSE_MS + 1);
    // Without this second notification the row would stay washed until
    // something else happened to re-render it.
    expect(seen).toHaveBeenCalledTimes(2);
    stop();
  });
});
