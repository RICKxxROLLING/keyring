import { useMemo, type ReactElement } from "react";
import type { PresenceUser } from "../../shared/realtime";
import { useGlobalPresence, usePresence } from "../lib/realtime";
import { useOptionalSession } from "../lib/session";
import { AvatarStack } from "./Avatar";

/** De-duplicates connections by user id, per design §C8.5 (same person on two devices = one avatar). */
function dedupeByUser(users: PresenceUser[]) {
  const seen = new Map<string, PresenceUser>();
  for (const u of users) {
    if (!seen.has(u.user.id)) seen.set(u.user.id, u);
  }
  return [...seen.values()];
}

/**
 * Who else is here right now.
 *
 * Else being the point: this sits directly above your own account row in the
 * rail, so including yourself put your avatar on screen twice, one line apart,
 * which reads as a bug rather than as presence. "Who's here" has always meant
 * other people — you already know you are here.
 */
export function GlobalPresenceBar(): ReactElement | null {
  const presence = useGlobalPresence();
  const session = useOptionalSession()?.session ?? null;
  const people = useMemo(
    () => dedupeByUser(presence).filter((p) => p.user.id !== session?.user.id),
    [presence, session?.user.id],
  );
  if (people.length === 0) return null;
  return (
    <div className="hidden items-center gap-2 border-r pr-3 sm:flex" style={{ borderColor: "var(--line)" }} title="Who's here now">
      <AvatarStack users={people.map((p) => p.user)} />
    </div>
  );
}

/**
 * Who else is looking at this property.
 *
 * Self-excluded for the same reason as the global bar, and more visibly so: it
 * renders "<name> is here too", which said "Riley is here too" to Riley on
 * every property page. "Too" only means anything about someone other than you.
 */
export function PropertyPresenceBar(props: { propertyId: string }): ReactElement | null {
  const presence = usePresence(props.propertyId);
  const session = useOptionalSession()?.session ?? null;
  const people = useMemo(
    () => dedupeByUser(presence).filter((p) => p.user.id !== session?.user.id),
    [presence, session?.user.id],
  );
  if (people.length === 0) return null;
  return (
    <div className="flex items-center gap-2 text-sm" style={{ color: "var(--ink-3)" }}>
      <AvatarStack users={people.map((p) => p.user)} />
      <span>
        {people.length === 1 ? `${people[0]?.user.displayName} is here too` : `${people.length} people here now`}
      </span>
    </div>
  );
}
