import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicWebhookTarget, isInternalHostname } from "../app/api/v1/_lib/notifications";
import { checkPublicDestination } from "../db/network-guard";

test("rejects webhook destinations on local or private networks", () => {
  for (const url of ["https://localhost/x", "https://127.0.0.1/", "https://10.1.2.3/", "https://172.20.0.1/", "https://192.168.1.10/", "https://169.254.169.254/latest", "https://100.64.0.1/", "https://[::1]/", "https://[fd00::1]/", "https://[::ffff:127.0.0.1]/", "https://2130706433/", "https://intranet.local/", "https://api.internal/"]) {
    assert.equal(isInternalHostname(new URL(url).hostname), true, url);
  }
  for (const url of ["https://hooks.example.com/x", "https://8.8.8.8/", "https://outlook.office.com/webhook", "https://[2001:4860:4860::8888]/"]) {
    assert.equal(isInternalHostname(new URL(url).hostname), false, url);
  }
});

test("rejects webhook domains that resolve to internal addresses", async () => {
  const webhook = (url: string) => ({ kind: "webhook" as const, configuration: { url } });
  await assert.rejects(assertPublicWebhookTarget(webhook("https://127.0.0.1.nip.io/x"), async () => ["127.0.0.1"]), /interna o privada/);
  await assert.rejects(assertPublicWebhookTarget(webhook("https://localtest.me/x"), async () => ["::1"]), /interna o privada/);
  await assert.rejects(assertPublicWebhookTarget(webhook("https://rebind.example.test/x"), async () => ["203.0.113.7", "192.168.0.4"]), /interna o privada/);
  await assert.rejects(assertPublicWebhookTarget(webhook("https://nx.example.test/x"), async () => { throw new Error("ENOTFOUND"); }), /resolver el dominio/);
  await assertPublicWebhookTarget(webhook("https://hooks.example.test/x"), async () => ["203.0.113.7", "2001:db8::1"]);
  await assertPublicWebhookTarget({ kind: "email", configuration: { recipients: ["a@b.cl"] } }, async () => { throw new Error("no debe resolver"); });
});

test("treats IPv4-mapped addresses returned by DNS like their IPv4 form", async () => {
  assert.equal(isInternalHostname("::ffff:10.0.0.5"), true);
  assert.equal(isInternalHostname("::ffff:8.8.8.8"), false);
  assert.deepEqual(await checkPublicDestination("8.8.8.8", async () => { throw new Error("no debe resolver IPs"); }), { ok: true });
});
