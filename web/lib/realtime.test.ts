import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/** A minimal, fully test-controlled WebSocket stand-in — jsdom has no real WebSocket. */
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;

  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: unknown[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
  triggerOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
  triggerMessage(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  triggerClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

function readyFrame(connId: string) {
  return {
    t: "ready" as const,
    v: 1,
    connId,
    user: { id: "usr_test0000000000000000000001", handle: "tester", displayName: "Tester", avatarColor: "#336699" },
    serverTime: new Date().toISOString(),
  };
}

describe("web/lib/realtime.ts", () => {
  beforeEach(() => {
    vi.resetModules();
    MockWebSocket.instances = [];
    // jsdom defines WebSocket as a read-only accessor, so a plain assignment throws
    // "Cannot assign to read only property". vi.stubGlobal goes through
    // defineProperty and is undone by vi.unstubAllGlobals in afterEach.
    vi.stubGlobal("WebSocket", MockWebSocket);
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, data: { items: [], unread: 0 } }), { status: 200 }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("exports exactly the API in §C10.4", async () => {
    const rt = await import("./realtime.js");
    const expected = [
      "RealtimeProvider",
      "useConnectionState",
      "usePropertyChannel",
      "usePresence",
      "useGlobalPresence",
      "useAnnouncePage",
      "useEntityEvents",
      "useResync",
      "useFieldLock",
      "usePropertyLocks",
      "useNotifications",
      "subscribeRaw",
    ].sort();
    expect(Object.keys(rt).sort()).toEqual(expected);
  });

  it("connects, sends hello on open, and reflects state as open after ready", async () => {
    const rt = await import("./realtime.js");
    const wrapper = ({ children }: { children: ReactNode }) => createElement(rt.RealtimeProvider, { children });

    const { result } = renderHook(() => rt.useConnectionState(), { wrapper });
    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0]!;

    act(() => ws.triggerOpen());
    expect(ws.sent[0]).toMatchObject({ t: "hello", v: 1 });

    act(() => ws.triggerMessage(readyFrame("conn_1")));
    await waitFor(() => expect(result.current.state).toBe("open"));
  });

  it("resubscribes every channel on reconnect and fires resync after every ready", async () => {
    vi.useFakeTimers();
    const rt = await import("./realtime.js");
    const wrapper = ({ children }: { children: ReactNode }) => createElement(rt.RealtimeProvider, { children });
    const resync = vi.fn();

    renderHook(
      () => {
        rt.usePropertyChannel("prp_test0000000000000000000001");
        rt.useResync(resync);
      },
      { wrapper },
    );

    const ws1 = MockWebSocket.instances[0]!;
    act(() => ws1.triggerOpen());
    act(() => ws1.triggerMessage(readyFrame("conn_1")));
    expect(resync).toHaveBeenCalledTimes(1);
    expect(
      ws1.sent.some((m) => (m as { t: string }).t === "sub" && (m as { channels: string[] }).channels.includes("property:prp_test0000000000000000000001")),
    ).toBe(true);

    act(() => ws1.triggerClose());
    // Full-jitter backoff is bounded by RECONNECT_MAX_MS (15s); advancing well past that
    // guarantees the reconnect timer has fired regardless of the random draw.
    act(() => vi.advanceTimersByTime(20000));
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);

    const ws2 = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    act(() => ws2.triggerOpen());
    act(() => ws2.triggerMessage(readyFrame("conn_2")));
    expect(resync).toHaveBeenCalledTimes(2);
    expect(
      ws2.sent.some((m) => (m as { t: string }).t === "sub" && (m as { channels: string[] }).channels.includes("property:prp_test0000000000000000000001")),
    ).toBe(true);
  });

  it("drops a held lock on disconnect", async () => {
    const rt = await import("./realtime.js");
    const wrapper = ({ children }: { children: ReactNode }) => createElement(rt.RealtimeProvider, { children });
    const key = { entityType: "note" as const, entityId: "not_test000000000000000000001", field: "body" };

    const { result } = renderHook(() => rt.useFieldLock(key), { wrapper });
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.triggerOpen());
    act(() => ws.triggerMessage(readyFrame("conn_1")));

    act(() => result.current.acquire());
    expect(ws.sent.some((m) => (m as { t: string }).t === "lock.acquire")).toBe(true);

    const holder = { id: "usr_test0000000000000000000001", handle: "tester", displayName: "Tester", avatarColor: "#336699" };
    act(() =>
      ws.triggerMessage({
        t: "lock.granted",
        key,
        holder,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("held"));

    act(() => ws.triggerClose());
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });
});
