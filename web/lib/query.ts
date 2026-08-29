// web/lib/query.ts — QueryClient + query key registry (owner T4). See design §C10.3.
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

export const qk = {
  session: ["session"] as const,
  dashboard: ["dashboard"] as const,
  properties: ["properties"] as const,
  dossier: (id: string) => ["dossier", id] as const,
  timeline: (id: string) => ["timeline", id] as const,
  workOrder: (id: string) => ["work-order", id] as const,
  workOrders: (propertyId: string | null) => ["work-orders", propertyId] as const,
  project: (id: string) => ["project", id] as const,
  vendors: ["vendors"] as const,
  notifications: ["notifications"] as const,
  unreadCount: ["notifications", "unread"] as const,
  search: (q: string) => ["search", q] as const,
  audit: (filters: string) => ["audit", filters] as const,
  ops: ["ops"] as const,
};
