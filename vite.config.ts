import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { appVersion } from "./scripts/version.mjs";

export default defineConfig({
  root: "web",
  // Baked in at build time so the footer needs no request to know what it is.
  // APP_VERSION wins when set, which is how the Docker build passes the value
  // it computed while the git history was still in the context.
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || appVersion()),
  },
  plugins: [react(), tailwindcss()],
  build: { outDir: "../dist/public", emptyOutDir: true, sourcemap: true },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
      "/ws": { target: "ws://localhost:8080", ws: true },
      "/healthz": "http://localhost:8080",
    },
  },
});
