import { getDb } from "@/db";
import { ensureDatabaseSeeded } from "@/db/seed";

export async function getSeededDb() {
  await ensureDatabaseSeeded();
  return getDb();
}
