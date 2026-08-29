import { buildApp } from "./app.js";
import { getEnv } from "./config/env.js";

const app = await buildApp();
const env = getEnv();

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info({ port: env.PORT, origin: env.APP_ORIGIN }, "stoop listening");
} catch (err) {
  app.log.error({ err }, "failed to start");
  process.exit(1);
}
