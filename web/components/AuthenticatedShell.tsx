import { useCallback, type ReactElement } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { RealtimeProvider, useAnnouncePage, useEntityEvents, useResync } from "../lib/realtime";
import { qk } from "../lib/query";
import { AppShell } from "./AppShell";

function RealtimeWiring(): null {
  // See design §C10.5: invalidate rather than patch, so the client can never drift from
  // the server's version numbers.
  const queryClient = useQueryClient();
  const location = useLocation();

  useAnnouncePage(location.pathname);

  const onEntity = useCallback(
    (e: { propertyId: string | null; entityType: string }) => {
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      if (e.propertyId) {
        void queryClient.invalidateQueries({ queryKey: qk.dossier(e.propertyId) });
        void queryClient.invalidateQueries({ queryKey: qk.timeline(e.propertyId) });
      }
      if (e.entityType === "vendor") void queryClient.invalidateQueries({ queryKey: qk.vendors });
    },
    [queryClient],
  );
  useEntityEvents(onEntity);

  const onResync = useCallback(() => {
    void queryClient.invalidateQueries();
  }, [queryClient]);
  useResync(onResync);

  return null;
}

export function AuthenticatedShell(): ReactElement {
  return (
    <RealtimeProvider>
      <RealtimeWiring />
      <AppShell>
        <Outlet />
      </AppShell>
    </RealtimeProvider>
  );
}
