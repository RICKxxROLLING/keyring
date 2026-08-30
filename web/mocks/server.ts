// web/mocks/server.ts — MSW node server backing component tests (owner T4). See design §C10.6.
import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);
