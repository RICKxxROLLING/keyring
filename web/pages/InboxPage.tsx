import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { Notification, Page } from "../../shared/types";
import { apiGet, apiPost } from "../lib/api";
import { qk } from "../lib/query";
import { formatRelativeTime } from "../lib/format";
import { Button } from "../components/Button";
import { EmptyState, Spinner } from "../components/Form";

export function InboxPage(): JSX.Element {
  const queryClient = useQueryClient();
  const notifications = useQuery({
    queryKey: qk.notifications,
    queryFn: () => apiGet<Page<Notification>>("/api/notifications"),
  });

  async function markRead(n: Notification) {
    if (n.readAt) return;
    await apiPost(`/api/notifications/${n.id}/read`);
    void queryClient.invalidateQueries({ queryKey: qk.notifications });
    void queryClient.invalidateQueries({ queryKey: qk.unreadCount });
  }

  async function markAllRead() {
    await apiPost("/api/notifications/read-all");
    void queryClient.invalidateQueries({ queryKey: qk.notifications });
    void queryClient.invalidateQueries({ queryKey: qk.unreadCount });
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-black text-slate-900">Inbox</h1>
        <Button variant="secondary" onClick={() => void markAllRead()}>
          Mark all read
        </Button>
      </div>

      {notifications.isPending && <Spinner />}
      {notifications.data && notifications.data.items.length === 0 && <EmptyState title="You're all caught up" />}
      {notifications.data && notifications.data.items.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {notifications.data.items.map((n) => (
            <li key={n.id} className={!n.readAt ? "bg-brand-50/40" : ""}>
              <Link
                to={n.url ?? "#"}
                onClick={() => void markRead(n)}
                className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50"
              >
                {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">{n.title}</p>
                  <p className="text-sm text-slate-600">{n.body}</p>
                  <p className="text-xs text-slate-400">{formatRelativeTime(n.createdAt)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
