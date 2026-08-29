import { useMemo } from "react";
import type { PresenceUser } from "../../shared/realtime";
import { useGlobalPresence, usePresence } from "../lib/realtime";
import { AvatarStack } from "./Avatar";

/** De-duplicates connections by user id, per design §C8.5 (same person on two devices = one avatar). */
function dedupeByUser(users: PresenceUser[]) {
  const seen = new Map<string, PresenceUser>();
  for (const u of users) {
    if (!seen.has(u.user.id)) seen.set(u.user.id, u);
  }
  return [...seen.values()];
}

export function GlobalPresenceBar(): JSX.Element | null {
  const presence = useGlobalPresence();
  const people = useMemo(() => dedupeByUser(presence), [presence]);
  if (people.length === 0) return null;
  return (
    <div className="hidden items-center gap-2 border-r border-slate-200 pr-3 sm:flex" title="Who's here now">
      <AvatarStack users={people.map((p) => p.user)} />
    </div>
  );
}

export function PropertyPresenceBar(props: { propertyId: string }): JSX.Element | null {
  const presence = usePresence(props.propertyId);
  const people = useMemo(() => dedupeByUser(presence), [presence]);
  if (people.length === 0) return null;
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <AvatarStack users={people.map((p) => p.user)} />
      <span>
        {people.length === 1 ? `${people[0]?.user.displayName} is here too` : `${people.length} people here now`}
      </span>
    </div>
  );
}
