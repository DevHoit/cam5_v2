import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createPortalSession, resolvePortalSession } from "../db/auth";
import { ClientLogoError, MAX_CLIENT_LOGO_BYTES, validateClientLogo } from "../db/client-branding";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import { createMigratedTestDatabase } from "./helpers/database";

const encoder = new TextEncoder();
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

test("accepts real PNG, JPEG, WebP and simple SVG logos by content, not by extension", () => {
  assert.equal(validateClientLogo(png).contentType, "image/png");
  assert.equal(validateClientLogo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16])).contentType, "image/jpeg");
  assert.equal(validateClientLogo(new Uint8Array([...encoder.encode("RIFF"), 0, 0, 0, 0, ...encoder.encode("WEBPVP8 ")])).contentType, "image/webp");
  const svg = encoder.encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="10" height="10"/></svg>');
  assert.equal(validateClientLogo(svg).contentType, "image/svg+xml");
});

test("rejects unknown formats, oversized files and active or external SVG content", () => {
  assert.throws(() => validateClientLogo(new Uint8Array()), ClientLogoError);
  assert.throws(() => validateClientLogo(encoder.encode("GIF89a")), /Formato no admitido/);
  assert.throws(() => validateClientLogo(new Uint8Array(MAX_CLIENT_LOGO_BYTES + 1).fill(0x89)), /superar/);
  for (const svg of [
    '<svg><script>alert(1)</script></svg>',
    '<svg onload="alert(1)"></svg>',
    '<svg><a href="javascript:alert(1)"><rect/></a></svg>',
    '<svg><image href="https://tracker.example/x.png"/></svg>',
    '<svg><foreignObject><div/></foreignObject></svg>',
    '<svg><style>@import url(https://x.example/a.css);</style></svg>',
    '<!DOCTYPE svg [<!ENTITY x "y">]><svg></svg>',
  ]) {
    assert.throws(() => validateClientLogo(encoder.encode(svg)), ClientLogoError, svg);
  }
});

test("exposes the active client's logo version in the portal session", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { adminEmail: "admin@example.test", adminName: "Administrador", adminPassword: "Temporal-2026", log: false });
    const [admin] = await db.select().from(schema.users).where(eq(schema.users.email, "admin@example.test")).limit(1);
    const session = await createPortalSession(db, admin.id);
    const before = await resolvePortalSession(db, session.token);
    assert.equal(before?.clientLogoUpdatedAt, null);

    const updatedAt = new Date("2026-11-11T15:00:00.000Z");
    const logo = validateClientLogo(png);
    await db.update(schema.clients).set({ logoData: logo.base64, logoContentType: logo.contentType, logoUpdatedAt: updatedAt }).where(eq(schema.clients.id, before!.clientId));
    const after = await resolvePortalSession(db, session.token);
    assert.equal(after?.clientLogoUpdatedAt, updatedAt.toISOString());
  } finally {
    await client.close();
  }
});
