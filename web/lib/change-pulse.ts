// web/lib/change-pulse.ts — "somebody else just changed this".
//
// Three accounts work in here at once. Until now, a work order one of them
// re-assigned simply had different words in it the next time you looked: the
// query invalidated, React re-rendered, and nothing said that anything had
// happened or who had done it.
//
// The realtime frame already carries everything needed — the entity, the actor,
// and (via presence) that actor's avatar colour — so this turns the stream into
// a short colour wash on the affected row. See the kr-pulse keyframe.
//
// ONE subscription, not one per row. A list of forty expenses would otherwise
// attach forty listeners to the socket and re-run forty closures on every
// frame. This is a single module-level store that rows read through
// useSyncExternalStore, the same shape realtime.ts already uses.
import { useSyncExternalStore } from "react";
import { subscribeRaw } from "./realtime";
import type { ServerMessage } from "../../shared/realtime";

/** How long a row stays washed. Long enough to catch on a glance back up. */
export const PULSE_MS = 1400;

/** Fallback wash when the actor is not someone we have a colour for. */
const UNKNOWN_ACTOR = "var(--ink-3)";

function key(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

class ChangePulseStore {
  /** entity key -> the colour to wash it in. */
  private active = new Map<string, string>();
  /** userId -> avatarColor, learned from presence frames. */
  private colors = new Map<string, string>();
  private selfId: string | null = null;

  private listeners = new Set<() => void>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private unsubscribe: (() => void) | null = null;
  private version = 0;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    this.attach();
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) this.detach();
    };
  };

  getSnapshot = (): number => this.version;

  colorFor(entityType: string, entityId: string): string | null {
    return this.active.get(key(entityType, entityId)) ?? null;
  }

  private emit(): void {
    this.version += 1;
    for (const fn of this.listeners) fn();
  }

  /**
   * Attach on the first subscriber and let go on the last.
   *
   * Nothing pulses on a page with no pulsing rows, and — more usefully — the
   * store holds no socket subscription in a test that never renders one.
   */
  private attach(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = subscribeRaw((msg) => this.ingest(msg));
  }

  /**
   * Everything this store knows, it learns from the socket.
   *
   * Public so it can be driven directly: the alternative is a test that stands
   * up a WebSocket to assert a colour lookup, which tests the harness.
   */
  ingest(msg: ServerMessage): void {
    if (msg.t === "ready") {
      this.selfId = msg.user.id;
      this.colors.set(msg.user.id, msg.user.avatarColor);
      return;
    }
    if (msg.t === "presence") {
      // The only place the client learns other people's avatar colours
      // without asking for a user directory it does not otherwise need.
      for (const p of msg.users) this.colors.set(p.user.id, p.user.avatarColor);
      return;
    }
    if (msg.t !== "entity") return;
    // Your own writes are not news. Without this every save you make would
    // flash the row you just edited, which reads as an error state.
    if (!msg.actorId || msg.actorId === this.selfId) return;
    this.pulse(msg.entityType, msg.entityId, this.colors.get(msg.actorId) ?? UNKNOWN_ACTOR);
  }

  private detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.active.clear();
  }

  private pulse(entityType: string, entityId: string, color: string): void {
    const k = key(entityType, entityId);
    const existing = this.timers.get(k);
    // A second change during the wash extends it rather than stacking a
    // second fade on top. See pulseProps for what this does and does not do
    // to the animation already running.
    if (existing) clearTimeout(existing);
    this.active.set(k, color);
    this.timers.set(
      k,
      setTimeout(() => {
        this.timers.delete(k);
        this.active.delete(k);
        this.emit();
      }, PULSE_MS),
    );
    this.emit();
  }

  reset(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.active.clear();
    this.colors.clear();
    this.selfId = null;
    this.emit();
  }
}

export const changePulses = new ChangePulseStore();

/**
 * The colour to wash this row in right now, or null.
 *
 * Pass the entity this row displays. Rows that do not name an entity — a
 * heading, a summary — simply do not call it.
 */
export function useChangePulse(
  entityType: string | undefined,
  entityId: string | undefined,
): string | null {
  useSyncExternalStore(changePulses.subscribe, changePulses.getSnapshot, changePulses.getSnapshot);
  if (!entityType || !entityId) return null;
  return changePulses.colorFor(entityType, entityId);
}

/**
 * Props to spread onto the element that should wash.
 *
 * A second change arriving mid-wash extends it rather than restarting it: the
 * class is already applied, and re-applying a class does not restart a running
 * CSS animation. Restarting properly would mean alternating between two
 * identical keyframes to force a new animation, and two people editing the same
 * row inside 1.4 seconds is not worth carrying that. The row stays washed for
 * longer, which is the right answer anyway.
 */
export function pulseProps(color: string | null): {
  className?: string;
  style?: Record<string, string>;
} {
  if (!color) return {};
  return {
    className: "kr-pulse",
    style: { "--kr-pulse": color },
  };
}
