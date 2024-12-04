import { drizzle } from "drizzle-orm/d1";

import * as schema from "./db/schema";

type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;

let db: DrizzleDB | null = null;

export function init(env: Env) {
  db ??= drizzle(env.DATABASE, {
    schema,
  });
}

export function getDB() {
  if (!db) {
    throw new Error("DB not initialized");
  }
  return db;
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
