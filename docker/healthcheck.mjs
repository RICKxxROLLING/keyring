#!/usr/bin/env node
// docker/healthcheck.mjs — used by the Dockerfile HEALTHCHECK instruction.
// Deliberately dependency-free (runs inside the runtime image, no node_modules
// lookup games). Exits 0 when GET /healthz returns 200, 1 otherwise.

const port = process.env.PORT || "8080";
const url = `http://127.0.0.1:${port}/healthz`;

try {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);
  if (res.status === 200) {
    process.exit(0);
  }
  console.error(`healthcheck: ${url} returned HTTP ${res.status}`);
  process.exit(1);
} catch (err) {
  console.error(
    `healthcheck: request to ${url} failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}
