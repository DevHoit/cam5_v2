import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

export function loadDatabaseEnvironment(): void {
  for (const path of [".env.local", ".env"]) {
    if (existsSync(path)) loadEnvFile(path);
  }
}
