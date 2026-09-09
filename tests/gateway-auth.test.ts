import assert from "node:assert/strict";
import test from "node:test";
import { createGatewayToken, gatewayCredentialRenewalExpiry, gatewayTokenDisplayPrefix, hashGatewayToken } from "../db/gateway-auth";

test("creates opaque gateway tokens and stores only deterministic hashes", () => {
  const first = createGatewayToken();
  const second = createGatewayToken();
  assert.match(first, /^cam5gw_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.equal(hashGatewayToken(first), hashGatewayToken(first));
  assert.notEqual(hashGatewayToken(first), hashGatewayToken(second));
  assert.equal(hashGatewayToken(first).length, 64);
  assert.equal(gatewayTokenDisplayPrefix(first), first.slice(0, 18));
});

test("renews gateway validity without changing the installed token", () => {
  const renewedAt = new Date("2026-01-01T00:00:00.000Z");
  const currentExpiry = new Date("2026-01-31T00:00:00.000Z");
  assert.equal(gatewayCredentialRenewalExpiry(currentExpiry, renewedAt, 90).toISOString(), "2026-05-01T00:00:00.000Z");
  assert.equal(gatewayCredentialRenewalExpiry(new Date("2025-12-01T00:00:00.000Z"), renewedAt, 90).toISOString(), "2026-04-01T00:00:00.000Z");
  assert.throws(() => gatewayCredentialRenewalExpiry(currentExpiry, renewedAt, 0), /entre 1 y 1825 días/);
});
