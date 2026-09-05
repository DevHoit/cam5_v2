import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { drizzle as drizzleBetterSqlite3 } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";
import path from "node:path";
import fs from "node:fs";

let localDbInstance: ReturnType<typeof drizzleBetterSqlite3<typeof schema>> | null = null;

export function getDb() {
  // Check Cloudflare D1 environment binding if available
  const globalEnv = (globalThis as unknown as { env?: { DB?: unknown } }).env;
  if (globalEnv?.DB) {
    return drizzleD1(globalEnv.DB as Parameters<typeof drizzleD1>[0], { schema });
  }

  if (!localDbInstance) {
    const dbDir = path.resolve(process.cwd(), ".db");
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const dbPath = path.join(dbDir, "cam5.db");
    const sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    localDbInstance = drizzleBetterSqlite3(sqlite, { schema });
  }

  return localDbInstance;
}
