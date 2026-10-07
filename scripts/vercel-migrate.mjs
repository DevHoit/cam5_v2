import { spawnSync } from "node:child_process";

const isVercelBuild = process.env.VERCEL === "1";
const vercelEnvironment = process.env.VERCEL_ENV?.trim();
const allowNonProductionMigration = process.env.HOIT_ALLOW_NONPROD_MIGRATIONS === "1";

if (!isVercelBuild) {
  console.log("Skipping database migration outside Vercel build.");
  process.exit(0);
}

if (vercelEnvironment !== "production" && !allowNonProductionMigration) {
  console.log(`Skipping database migration for Vercel environment '${vercelEnvironment || "unknown"}'. Production migrations run only on the production deployment.`);
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required for Vercel deployments so schema migrations can run before build.");
  process.exit(1);
}

console.log("Applying database migrations before Vercel build...");
const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(executable, ["tsx", "db/migrate.ts"], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error("Unable to start database migration.", result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
