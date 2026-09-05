import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";

export type Cam5Database = PostgresJsDatabase<typeof schema>;

let client: Sql | undefined;
let database: Cam5Database | undefined;

export function getDb(databaseUrl = process.env.DATABASE_URL): Cam5Database {
  if (!databaseUrl) throw new Error("DATABASE_URL no está configurada.");

  if (!client || !database) {
    client = postgres(databaseUrl, {
      max: process.env.NODE_ENV === "production" ? 10 : 2,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
    database = drizzle(client, { schema });
  }

  return database;
}

export async function closeDb(): Promise<void> {
  if (client) await client.end({ timeout: 5 });
  client = undefined;
  database = undefined;
}
