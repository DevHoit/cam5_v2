import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Cam5Database } from "../../db/index";
import * as schema from "../../db/schema";

/** Crea una base PGlite en memoria con todas las migraciones registradas en drizzle/meta/_journal.json. */
export async function createMigratedTestDatabase() {
  const journal = JSON.parse(await readFile(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: Array<{ tag: string }> };
  const client = new PGlite();
  for (const { tag } of journal.entries) {
    const migration = await readFile(new URL(`../../drizzle/${tag}.sql`, import.meta.url), "utf8");
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  const db = drizzle(client, { schema }) as unknown as Cam5Database;
  return { client, db };
}
