import { AsyncLocalStorage } from "async_hooks";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "./db/schema";

type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;

interface Ctx {
  _db: D1Database;
  db: DrizzleDB;
}

const globalCtx = new AsyncLocalStorage<Ctx>();

export function init(env: Env) {
  globalCtx.enterWith({
    _db: env.DATABASE,
    db: drizzle(env.DATABASE, {
      schema,
    }),
  });
}

export function getDB() {
  const ctx = globalCtx.getStore();
  if (!ctx) {
    throw new Error("No context found");
  }
  return ctx.db;
}

export function requiresAuthentication(channelName: string) {
  if (channelName.startsWith("private-")) {
    return true;
  }
  if (channelName.startsWith("presence-")) {
    return true;
  }
  return false;
}
