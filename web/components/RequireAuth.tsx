import type { ReactNode, ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useSession } from "../lib/session";
import { Spinner } from "./Form";

export function RequireAuth(props: { children: ReactNode }): ReactElement {
  const { status, needsSetup } = useSession();
  const location = useLocation();

  if (status === "loading") {
    return <Spinner label="Loading Stoop…" />;
  }
  if (status === "unauthenticated") {
    if (needsSetup) return <Navigate to="/setup" replace />;
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{props.children}</>;
}

export function RequireOwner(props: { children: ReactNode }): ReactElement {
  const { session } = useSession();
  if (!session) return <Navigate to="/login" replace />;
  if (session.user.role !== "owner") {
    return (
      <div className="mx-auto max-w-lg p-6 text-center">
        <p className="text-lg font-semibold text-slate-800">Owner access required</p>
        <p className="mt-1 text-sm text-slate-500">Ask an owner to make this change.</p>
      </div>
    );
  }
  return <>{props.children}</>;
}
