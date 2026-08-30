import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OfflineBanner } from "./OfflineBanner";

describe("OfflineBanner", () => {
  let originalOnLine: boolean;

  beforeEach(() => {
    originalOnLine = navigator.onLine;
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => originalOnLine });
  });

  it("shows an explicit offline banner and never implies a queued write", () => {
    render(<OfflineBanner />);

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/Offline/);
    expect(banner).toHaveTextContent(/not saved while offline/);
  });
});
