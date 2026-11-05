import assert from "node:assert/strict";
import test from "node:test";
import { isInternalHostname } from "../app/api/v1/_lib/notifications";

test("rejects webhook destinations on local or private networks", () => {
  for (const url of ["https://localhost/x", "https://127.0.0.1/", "https://10.1.2.3/", "https://172.20.0.1/", "https://192.168.1.10/", "https://169.254.169.254/latest", "https://100.64.0.1/", "https://[::1]/", "https://[fd00::1]/", "https://[::ffff:127.0.0.1]/", "https://2130706433/", "https://intranet.local/", "https://api.internal/"]) {
    assert.equal(isInternalHostname(new URL(url).hostname), true, url);
  }
  for (const url of ["https://hooks.example.com/x", "https://8.8.8.8/", "https://outlook.office.com/webhook", "https://[2001:4860:4860::8888]/"]) {
    assert.equal(isInternalHostname(new URL(url).hostname), false, url);
  }
});
