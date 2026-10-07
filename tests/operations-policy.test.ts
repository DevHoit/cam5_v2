import assert from "node:assert/strict";
import test from "node:test";
import { operationsPolicy } from "../db/operations-policy";

test("preview cannot inherit the production scheduler credential or enable dispatch", () => {
  assert.throws(() => operationsPolicy({ VERCEL_ENV: "preview", CRON_SECRET: "production-only" }), /token propio/);
  assert.throws(() => operationsPolicy({ VERCEL_ENV: "preview", HOIT_PREVIEW_OPERATIONS_TOKEN: "preview-only" }), /sitio/);
  const policy = operationsPolicy({
    VERCEL_ENV: "preview", CRON_SECRET: "production-only", HOIT_PREVIEW_OPERATIONS_TOKEN: "preview-only",
    HOIT_PREVIEW_OPERATIONS_SITE_CODE: " E2E-STAGING ", HOIT_OPERATIONS_MODE: "dispatch",
  });
  assert.deepEqual(policy, { secret: "preview-only", siteCode: "E2E-STAGING", mode: "evaluate_only" });
});

test("production retains the existing operational cycle authentication and dispatch", () => {
  assert.throws(() => operationsPolicy({ VERCEL_ENV: "production" }), /CRON_SECRET/);
  assert.deepEqual(operationsPolicy({ VERCEL_ENV: "production", CRON_SECRET: "production-only", HOIT_PREVIEW_OPERATIONS_TOKEN: "preview-only" }), {
    secret: "production-only", siteCode: null, mode: "dispatch",
  });
});


test("unknown non-production environments fail closed instead of dispatching globally", () => {
  assert.throws(() => operationsPolicy({ VERCEL_ENV: "staging", CRON_SECRET: "production-only" }), /token propio/);
});
