import { useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useSession } from "../lib/session";
import { useOnlineStatus } from "../lib/offline";
import { useConnectionState } from "../lib/realtime";
import { BellIcon, HomeIcon, PlusIcon, SearchIcon, UserIcon, WifiOffIcon } from "./icons";
import { IconButton } from "./Button";
import { GlobalPresenceBar } from "./PresenceBar";
import { QuickAddSheet } from "./QuickAdd";
import { NotificationBell } from "./NotificationBell";
import { OfflineBanner } from "./OfflineBanner";

const NAV_ITEMS = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/search", label: "Search", icon: SearchIcon },
  { to: "/inbox", label: "Inbox", icon: BellIcon },
  { to: "/settings", label: "You", icon: UserIcon },
];

export function AppShell(props: { children: ReactNode }): JSX.Element {
  const { session, logout } = useSession();
  const online = useOnlineStatus();
  const connection = useConnectionState();
  const navigate = useNavigate();
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const isOffline = !online || connection.state === "offline";

  return (
    <div className="min-h-screen bg-slate-50">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <Link to="/" className="flex items-center gap-2 font-extrabold tracking-tight text-slate-900">
            <span className="text-brand-600">Stoop</span>
          </Link>

          <button
            type="button"
            onClick={() => navigate("/search")}
            className="tap-target hidden flex-1 items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm text-slate-500 hover:bg-slate-100 sm:flex"
          >
            <SearchIcon width={16} height={16} />
            Search properties, notes, work orders…
          </button>

          <div className="ml-auto flex items-center gap-1">
            <GlobalPresenceBar />
            <IconButton label="Quick add" onClick={() => setQuickAddOpen(true)} className="hidden sm:inline-flex">
              <PlusIcon />
            </IconButton>
            <NotificationBell />
            {session && (
              <nav className="hidden items-center gap-3 border-l border-slate-200 pl-3 text-sm md:flex">
                <NavLink to="/settings" className="font-medium text-slate-600 hover:text-slate-900">
                  {session.user.displayName}
                </NavLink>
                {session.user.role === "owner" && (
                  <NavLink to="/admin" className="font-medium text-slate-600 hover:text-slate-900">
                    Admin
                  </NavLink>
                )}
                <button type="button" onClick={() => void logout()} className="font-medium text-slate-500 hover:text-slate-900">
                  Log out
                </button>
              </nav>
            )}
          </div>
        </div>
        {isOffline && <OfflineBanner />}
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 py-4 pb-24 md:pb-8">
        {props.children}
      </main>

      <button
        type="button"
        onClick={() => setQuickAddOpen(true)}
        aria-label="Quick add"
        className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg hover:bg-brand-700 sm:hidden"
      >
        <PlusIcon width={26} height={26} />
      </button>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white md:hidden" aria-label="Primary">
        <div className="mx-auto flex max-w-6xl">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `tap-target flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium ${
                  isActive ? "text-brand-600" : "text-slate-500"
                }`
              }
            >
              <item.icon width={22} height={22} />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>

      {isOffline && (
        <div
          className="fixed bottom-20 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white shadow md:hidden"
          role="status"
        >
          <WifiOffIcon width={14} height={14} />
          Offline
        </div>
      )}

      <QuickAddSheet open={quickAddOpen} onClose={() => setQuickAddOpen(false)} />
    </div>
  );
}
