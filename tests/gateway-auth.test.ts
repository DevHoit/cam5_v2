import assert from "node:assert/strict";
import test from "node:test";
import { createGatewayToken, gatewayTokenDisplayPrefix, hashGatewayToken } from "../db/gateway-auth";

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
