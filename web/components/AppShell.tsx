import { useState, type ReactNode, type ReactElement } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useSession } from "../lib/session";
import { useOnlineStatus } from "../lib/offline";
import { useConnectionState } from "../lib/realtime";
import { BellIcon, HomeIcon, PlusIcon, SearchIcon, UserIcon, WifiOffIcon } from "./icons";
import { QuickAddSheet } from "./QuickAdd";
import { NotificationBell } from "./NotificationBell";
import { OfflineBanner } from "./OfflineBanner";
import { KeyRail, KeyStrip } from "./KeyRail";
import { KeyGlyph } from "./KeyGlyph";
import { Avatar } from "./Avatar";
import { ThemeToggle } from "./ThemeToggle";

const NAV_ITEMS = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/search", label: "Search", icon: SearchIcon },
  { to: "/inbox", label: "Inbox", icon: BellIcon },
  { to: "/settings", label: "You", icon: UserIcon },
];

/**
 * The Keyring shell: the keyring on the left, content beside it.
 *
 * The rail is the design's organizing element, and on desktop it is the ONLY
 * navigation — there is no top bar, because everything one would have held is
 * already on the ring.
 *
 * On phones the rail collapses to a horizontal strip of key tags under a
 * matching header, and the bottom nav stays, because the phone-first brief
 * still holds — the handoff does not cover mobile, so the language is extended
 * rather than replaced.
 */
export function AppShell(props: { children: ReactNode }): ReactElement {
  const { session } = useSession();
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
        {/* Mobile only. On desktop there is no top bar at all: the rail already
            carries the identity, the standing links and the account controls,
            so a band of chrome across the top was a second navigation for
            things that were already on screen.

            On mobile the rail cannot be there, so the header IS the ring: the
            master key and the clasp on one row, the key tags hanging below it
            on the same surface. Same metaphor, turned on its side. */}
        <header
          className="lg:hidden"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 30,
            background: "var(--bg-2)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px clamp(12px, 3vw, 28px) 2px",
            }}
          >
            <NavLink
              to="/"
              end
              aria-label="The keyring — all properties"
              style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink)" }}
            >
              <KeyGlyph color="var(--ink-2)" size="rail" holeColor="var(--bg-2)" />
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 19,
                  fontWeight: 500,
                  letterSpacing: "-0.01em",
                }}
              >
                Keyring
              </span>
            </NavLink>

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                onClick={() => navigate("/search")}
                aria-label="Search"
                className="tap-target"
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 36,
                  height: 36,
                  borderRadius: 999,
                  color: "var(--ink-2)",
                }}
              >
                <SearchIcon width={17} height={17} />
              </button>
              <ThemeToggle />
              <NotificationBell />
              {session && (
                <NavLink to="/settings" title={session.user.displayName}>
                  <Avatar user={session.user} size={30} />
                </NavLink>
              )}
            </div>
          </div>
          <KeyStrip />
        </header>

        {isOffline && <OfflineBanner />}

        {/* kr-content centres and caps the column, and its inline padding is
            fluid — so this works from a 320px phone up to an ultrawide without
            the 1360px min-width the mock assumed. */}
        <main id="main" className="kr-content" style={{ flex: 1, paddingBottom: 96 }}>
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

