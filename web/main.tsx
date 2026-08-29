import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { SessionProvider } from "./lib/session";
import { queryClient } from "./lib/query";
import { registerServiceWorker } from "./lib/offline";
import "./styles.css";

async function bootstrap() {
  if (import.meta.env.VITE_USE_MOCKS) {
    const { worker } = await import("./mocks/browser");
    await worker.start({ onUnhandledRequest: "bypass" });
  }

  registerServiceWorker();

  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("#root element missing");

  createRoot(rootEl).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <SessionProvider>
            <App />
          </SessionProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void bootstrap();
