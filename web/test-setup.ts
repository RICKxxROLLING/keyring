// web/test-setup.ts — vitest "web" project setupFile (owner T4). See design §C3.3.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import * as React from "react";
import { server } from "./mocks/server";

// vitest.config.ts is frozen (§C3.3) and carries no @vitejs/plugin-react, so esbuild transpiles
// this project's JSX in classic mode (`React.createElement(...)`) instead of the automatic
// runtime `vite.config.ts` configures for real dev/build. None of our component files import
// React as a value (React 19 + the automatic runtime never needs to), so under test that classic
// transform hits a bare, undeclared `React` reference. Exposing it as a global — exactly like
// Vite's real automatic-runtime output needs no import at all — fixes every test file at once
// without touching the frozen config or adding a `import React` to every component.
(globalThis as unknown as { React: typeof React }).React = React;

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Unmount between tests. Without this every render stays in the document, so
// the second test in a file that renders the same component gets "found
// multiple elements with the role textbox" — a failure that says nothing about
// the component and everything about the harness.
afterEach(cleanup);

// jsdom does not implement matchMedia; several components probe it defensively.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
