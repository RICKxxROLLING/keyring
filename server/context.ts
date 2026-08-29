import type { FastifyInstance } from "fastify";
import type { Env } from "./config/env.js";
import type { Db } from "./db/index.js";

export interface AppContext {
  app: FastifyInstance;
  db: Db;
  env: Env;
}
