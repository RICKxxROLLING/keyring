import { useState, type ReactNode, type ReactElement } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useSession } from "../lib/session";
import { useOnlineStatus } from "../lib/offline";
import { useConnectionState } from "../lib/realtime";
import { BellIcon, HomeIcon, PlusIcon, SearchIcon, UserIcon, WifiOffIcon } from "./icons";
import { GlobalPresenceBar } from "./PresenceBar";
import { QuickAddSheet } from "./QuickAdd";
import { NotificationBell } from "./NotificationBell";
import { OfflineBanner } from "./OfflineBanner";
import { KeyRail } from "./KeyRail";
import { ThemeToggle } from "./ThemeToggle";

const NAV_ITEMS = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/search", label: "Search", icon: SearchIcon },
  { to: "/inbox", label: "Inbox", icon: BellIcon },
  { to: "/settings", label: "You", icon: UserIcon },
];

/**
 * The Keyring shell: the keyring rail on the left, a quiet top bar, content.
 *
 * The rail is the design's organizing element. On phones it collapses to a
 * horizontal strip of key tags (see KeyRail) and the existing bottom nav is
 * kept, because the phone-first brief still holds — the handoff simply does
 * not cover mobile, so the language is extended rather than replaced.
 */
export function AppShell(props: { children: ReactNode }): ReactElement {
  const { session, logout } = useSession();
  const online = useOnlineStatus();
  const connection = useConnectionState();
  const navigate = useNavigate();
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const isOffline = !online || connection.state === "offline";

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex" }}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <KeyRail />

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 30,
            background: "var(--bg)",
            borderBottom: "1px solid var(--line-soft)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 20px",
            }}
          >
            <button
              type="button"
              onClick={() => navigate("/search")}
              className="kr-search"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flex: 1,
                maxWidth: 340,
                minHeight: 40,
                padding: "0 12px",
                background: "var(--panel-2)",
                border: "1px solid var(--line)",
                borderRadius: 10,
                color: "var(--ink-3)",
                fontSize: 13,
                textAlign: "left",
              }}
            >
              <SearchIcon width={15} height={15} />
              Find a door, a tenant, a receipt
            </button>

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              <GlobalPresenceBar />
              <ThemeToggle />
              <NotificationBell />
              {session && (
                <>
                  <NavLink
                    to="/settings"
                    title={session.user.displayName}
                    style={{
                      display: "grid",
                      placeItems: "center",
                      width: 32,
                      height: 32,
                      borderRadius: 999,
                      background: "oklch(0.755 0.110 82 / 0.30)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--ink)",
                    }}
                  >
                    {initials(session.user.displayName)}
                  </NavLink>
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="kr-rail-link hidden md:block"
                    style={{ fontSize: 13, color: "var(--ink-3)" }}
                  >
                    Log out
                  </button>
                </>
              )}
            </div>
          </div>
          {isOffline && <OfflineBanner />}
        </header>

        <main id="main" style={{ flex: 1, padding: "0 20px 96px" }} className="md:pb-8">
          {props.children}
        </main>
      </div>

      <button
        type="button"
        onClick={() => setQuickAddOpen(true)}
        aria-label="Quick add"
        className="sm:hidden"
        style={{
          position: "fixed",
          bottom: 80,
          right: 16,
          zIndex: 30,
          display: "grid",
          placeItems: "center",
          width: 56,
          height: 56,
          borderRadius: 999,
          background: "var(--ink)",
          color: "var(--panel)",
          boxShadow: "var(--shadow)",
        }}
      >
        <PlusIcon width={26} height={26} />
      </button>

      <nav
        className="md:hidden"
        aria-label="Primary"
        style={{
          position: "fixed",
          insetInline: 0,
          bottom: 0,
          zIndex: 30,
          background: "var(--panel)",
          borderTop: "1px solid var(--line)",
        }}
      >
        <div style={{ display: "flex" }}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className="tap-target"
              style={({ isActive }) => ({
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                padding: "8px 0",
                minHeight: 56,
                fontSize: 11.5,
                fontWeight: 600,
                color: isActive ? "var(--ink)" : "var(--ink-3)",
              })}
            >
              <item.icon width={22} height={22} />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>

      {isOffline && (
        <div
          className="md:hidden"
          role="status"
          style={{
            position: "fixed",
            bottom: 80,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 12px",
            borderRadius: 999,
            background: "var(--ink)",
            color: "var(--panel)",
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          <WifiOffIcon width={14} height={14} />
          Offline
        </div>
      )}

      <QuickAddSheet open={quickAddOpen} onClose={() => setQuickAddOpen(false)} />
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}
