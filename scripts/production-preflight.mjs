import { pathToFileURL } from "node:url";

// Compare database destinations, never credentials. Neon pooled and direct
// connection URLs refer to the same endpoint and must not pass as isolated.
export function databaseIdentity(value) {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw new Error("Invalid PostgreSQL destination");
  }
  const hostname = url.hostname.endsWith(".neon.tech")
    ? url.hostname.replace(/-pooler(?=\.)/, "")
    : url.hostname;
  return `${hostname}:${url.port || "5432"}/${decodeURIComponent(url.pathname.slice(1))}`;
}

export function checkIsolation(stagingUrl, productionUrl) {
  if (!stagingUrl || !productionUrl) return { ok: false, code: "database_urls_missing" };
  try {
    return databaseIdentity(stagingUrl) === databaseIdentity(productionUrl)
      ? { ok: false, code: "shared_database" }
      : { ok: true, code: "distinct_database_destinations" };
  } catch {
    // Never echo URLs or the parser's exception: they may contain passwords.
    return { ok: false, code: "database_url_invalid" };
  }
}

export async function checkHealth(baseUrl, expectedRevision, fetcher = fetch) {
  try {
    const url = new URL("/api/v1/health", baseUrl);
    if (url.protocol !== "https:" || url.username || url.password) return { ok: false, code: "invalid_staging_url" };
    const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    const body = await response.json();
    if (response.status !== 200 || body.status !== "ok" || body.database !== "ok") {
      return { ok: false, code: "staging_unhealthy" };
    }
    if (body.deployment?.environment !== "preview") return { ok: false, code: "staging_environment_mismatch" };
    if (expectedRevision && body.deployment?.revision !== expectedRevision) return { ok: false, code: "staging_revision_mismatch" };
    return { ok: true, code: "staging_health_ok" };
  } catch {
    return { ok: false, code: "staging_health_unavailable" };
  }
}

async function main() {
  const checks = {
    isolation: checkIsolation(process.env.HOIT_STAGING_DATABASE_URL, process.env.HOIT_PRODUCTION_DATABASE_URL),
    health: await checkHealth(process.env.HOIT_STAGING_URL || "https://staging.hoitlive.com", process.env.HOIT_EXPECTED_REVISION),
  };
  const ok = Object.values(checks).every((check) => check.ok);
  console.log(JSON.stringify({ ok, checks }, null, 2));
  process.exitCode = ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
