import assert from "node:assert/strict";
import test from "node:test";
import { checkHealth, checkIsolation } from "../scripts/production-preflight.mjs";

test("isolation fails for Neon pooled/direct URLs and different credentials on the same DB", () => {
  assert.deepEqual(checkIsolation(
    "postgresql://staging:secret@ep-example-pooler.sa-east-1.aws.neon.tech/db?sslmode=require",
    "postgresql://prod:another@ep-example.sa-east-1.aws.neon.tech:5432/db",
  ), { ok: false, code: "shared_database" });
  assert.equal(checkIsolation("postgresql://a:b@ep-stage.neon.tech/db", "postgresql://a:b@ep-prod.neon.tech/db").ok, true);
});

test("missing or malformed isolation inputs fail without leaking credentials", () => {
  assert.equal(checkIsolation(undefined, undefined).ok, false);
  const result = checkIsolation("https://user:SECRET@host/db", "invalid-SECRET");
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes("SECRET"), false);
});

test("health rejects a stale revision, production alias, unhealthy DB and a redirect", async () => {
  const healthy = { status: "ok", database: "ok", deployment: { environment: "preview", revision: "candidate" } };
  const fetcher = (body, status = 200) => async (_url, options) => {
    assert.equal(options.redirect, "error");
    return Response.json(body, { status });
  };
  assert.equal((await checkHealth("https://staging.hoitlive.com", "candidate", fetcher(healthy))).ok, true);
  assert.equal((await checkHealth("https://staging.hoitlive.com", "old", fetcher(healthy))).code, "staging_revision_mismatch");
  assert.equal((await checkHealth("https://staging.hoitlive.com", undefined, fetcher({ ...healthy, deployment: { environment: "production" } }))).ok, false);
  assert.equal((await checkHealth("https://staging.hoitlive.com", undefined, fetcher({ status: "degraded", database: "unavailable" }, 503))).ok, false);
  assert.equal((await checkHealth("https://staging.hoitlive.com", undefined, async () => { throw new Error("redirect"); })).ok, false);
});
