import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiGet } from "../lib/api";
import { qk } from "../lib/query";
import { useNotifications } from "../lib/realtime";
import { BellIcon } from "./icons";
import type { ReactElement } from "react";

/**
 * The unread badge prefers the live socket count (design §C8.8) and falls back to — or is
 * topped up by — the polled REST count, since the inbox (not the socket) is the record.
 */
export function NotificationBell(): ReactElement {
  const live = useNotifications();
  const fetched = useQuery({
    queryKey: qk.unreadCount,
    queryFn: () => apiGet<{ unread: number }>("/api/notifications/unread-count"),
    refetchInterval: 60_000,
  });

  const unread = Math.max(live.unread, fetched.data?.unread ?? 0);

  return (
    <Link
      to="/inbox"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      className="tap-target relative hidden items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 sm:inline-flex"
    >
      <BellIcon />
      {unread > 0 && (
        <span
          className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white"
          aria-hidden="true"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
