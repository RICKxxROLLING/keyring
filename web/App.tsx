import { AppRoutes } from "./routes";
import type { ReactElement } from "react";
import { InstanceBanner } from "./components/InstanceBanner";

export function App(): ReactElement {
  return (
    <>
      <InstanceBanner />
      <AppRoutes />
    </>
  );
}
