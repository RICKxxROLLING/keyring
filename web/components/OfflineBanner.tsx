import { useEffect } from "react";
import { formatRelativeTime } from "../lib/format";
import { getLastOnline, markLastOnline, useOnlineStatus } from "../lib/offline";
import { WifiOffIcon } from "./icons";

/** Shown while offline: last-saved view + last-updated time, per design §C10.7. Never implies a queued write. */
export function OfflineBanner(): JSX.Element {
  const online = useOnlineStatus();
  const lastOnline = getLastOnline();

  useEffect(() => {
    if (online) markLastOnline();
  }, [online]);

  return (
    <div
      className="flex items-center justify-center gap-2 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800"
      role="status"
    >
      <WifiOffIcon width={14} height={14} />
      Offline — showing the last saved view{lastOnline ? `, updated ${formatRelativeTime(lastOnline)}` : ""}. Changes
      are not saved while offline.
    </div>
  );
}
