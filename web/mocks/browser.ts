// web/mocks/browser.ts — MSW worker for VITE_USE_MOCKS=1 npm run dev:web (owner T4).
import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

export const worker = setupWorker(...handlers);
