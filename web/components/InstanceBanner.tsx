import { useEffect, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/api";

/**
 * "TEST SERVER" across the top of every page, the sign-in page included, when
 * this copy of Keyring is not the real one (KEYRING_INSTANCE is set).
 *
 * The two copies look identical by design — the test server runs the exact
 * image that will be promoted — so without this the only difference between
 * them is the address bar. The tab title gets the label too, because the strip
 * scrolls away and the tab does not.
 *
 * Renders nothing in production, and nothing while the answer is loading or
 * if the request fails: a missing banner is the production look, so it must
 * never appear by accident there.
 */
export function InstanceBanner(): ReactElement | null {
  const { data } = useQuery({
    queryKey: ["instance"],
    queryFn: () => apiGet<{ instance: string | null }>("/api/instance"),
    staleTime: Infinity,
    retry: false,
  });
  const instance = data?.instance ?? null;

  useEffect(() => {
    if (!instance) return;
    const base = document.title.replace(/^\[[^\]]*\]\s*/, "");
    document.title = `[${instance.toUpperCase()}] ${base}`;
  }, [instance]);

  if (!instance) return null;

  return (
    <div
      role="note"
      aria-label={`${instance} server`}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        flexWrap: "wrap",
        padding: "5px 16px",
        fontSize: 11.5,
        fontWeight: 600,
        lineHeight: 1.35,
        textAlign: "center",
        color: "var(--warn)",
        background:
          "repeating-linear-gradient(-45deg, var(--warn-fill) 0 10px, transparent 10px 20px), var(--panel)",
        borderBottom: "1px solid var(--warn)",
      }}
    >
      <span className="kr-label" style={{ color: "inherit", letterSpacing: "0.12em" }}>
        {instance} server
      </span>
      <span>Demo data only — nothing here reaches the real Keyring.</span>
    </div>
  );
}
