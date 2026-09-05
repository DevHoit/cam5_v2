import { defineConfig } from "drizzle-kit";
import { loadDatabaseEnvironment } from "./db/load-env";

loadDatabaseEnvironment();
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  out: "./drizzle",
  schema: "./db/schema.ts",
  dialect: "postgresql",
  strict: true,
  verbose: true,
  ...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
});
