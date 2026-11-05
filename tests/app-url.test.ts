import assert from "node:assert/strict";
import test from "node:test";
import { appBaseUrl } from "../db/app-url";

test("resolves the public portal URL from APP_URL, Vercel or localhost", () => {
  assert.equal(appBaseUrl({ APP_URL: "https://core.hoitlive.com/", VERCEL_PROJECT_PRODUCTION_URL: "cam5v2.vercel.app" }), "https://core.hoitlive.com");
  assert.equal(appBaseUrl({ VERCEL_PROJECT_PRODUCTION_URL: "core.hoitlive.com" }), "https://core.hoitlive.com");
  assert.equal(appBaseUrl({}), "http://localhost:3000");
});
