import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { readReleaseBundle, ReleaseBundleError, releaseOffer, sha256Hex, verifyReleaseSignature } from "../db/gateway-releases";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import { createMigratedTestDatabase } from "./helpers/database";

/** tar ustar mínimo, como el que arma gateway/tools/release/build_release.sh. */
function tarGz(entries: Array<{ name: string; data?: string; type?: string }>): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? "");
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, "utf8");
    header.write("0000755\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("00000000000\0", 136);
    header.write("        ", 148);
    header.write(entry.type ?? "0", 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

const validEntries = [
  { name: "VERSION", data: "1.3.0\n" },
  { name: "files/cache/cam5-gateway/cam5-gateway", data: "\u007fELF binario" },
  { name: "files/data/hoit/bin/hoit_update.sh", data: "#!/bin/sh\n" },
];

test("reads VERSION and the file list and rejects paths outside the allowed folders", () => {
  assert.deepEqual(readReleaseBundle(tarGz(validEntries)), {
    version: "1.3.0",
    files: ["/cache/cam5-gateway/cam5-gateway", "/data/hoit/bin/hoit_update.sh"],
  });
  assert.throws(() => readReleaseBundle(tarGz([...validEntries, { name: "files/etc/shadow", data: "x" }])), /rutas permitidas/);
  assert.throws(() => readReleaseBundle(tarGz([...validEntries, { name: "files/cache/cam5-gateway/gateway.env", data: "x" }])), /rutas permitidas/);
  assert.throws(() => readReleaseBundle(tarGz([...validEntries, { name: "files/data/hoit/bin/../../../etc/passwd", data: "x" }])), ReleaseBundleError);
  assert.throws(() => readReleaseBundle(tarGz([...validEntries, { name: "files/data/hoit/bin/enlace", type: "2" }])), /enlaces/);
  assert.throws(() => readReleaseBundle(tarGz(validEntries.slice(1))), /VERSION/);
  assert.throws(() => readReleaseBundle(tarGz([validEntries[0], validEntries[2]])), /binario/);
  assert.throws(() => readReleaseBundle(Buffer.from("no es gzip")), /tar\.gz/);
});

test("accepts only bundles signed with the release key", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
  const bundle = tarGz(validEntries);
  const signature = sign(null, bundle, privateKey).toString("base64");
  assert.equal(verifyReleaseSignature(bundle, signature, publicKeyBase64), true);
  const tampered = Buffer.from(bundle);
  tampered[tampered.length - 10] ^= 1;
  assert.equal(verifyReleaseSignature(tampered, signature, publicKeyBase64), false);
  assert.equal(verifyReleaseSignature(bundle, signature), false, "a key other than HOIT's is rejected");
  assert.equal(verifyReleaseSignature(bundle, "abc", publicKeyBase64), false);
});

test("offers the assigned version only while the gateway reports another one", () => {
  const target = { version: "1.3.0", sha256: "a".repeat(64), signature: "sig", sizeBytes: 1234 };
  const assignedAt = new Date("2026-11-16T20:00:00Z");
  assert.equal(releaseOffer(null, "1.2.1", null), null);
  assert.equal(releaseOffer(target, "1.3.0", assignedAt), null);
  const offer = releaseOffer(target, "1.2.1", assignedAt);
  assert.deepEqual(offer, { version: "1.3.0", sha256: target.sha256, signature: "sig", size: 1234, attempt: offer!.attempt });
  assert.notEqual(releaseOffer(target, "1.2.1", new Date("2026-11-16T21:00:00Z"))!.attempt, offer!.attempt, "reassigning changes the attempt so a failed install is retried");
});

test("stores the bundle bytes intact and links the target release to the gateway", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { log: false });
    const [gateway] = await db.select().from(schema.gateways).limit(1);
    const bundle = tarGz(validEntries);
    const [release] = await db.insert(schema.gatewayReleases).values({
      version: "1.3.0", sha256: sha256Hex(bundle), signature: "x".repeat(88), sizeBytes: bundle.length, bundle,
    }).returning({ id: schema.gatewayReleases.id });
    await db.update(schema.gateways).set({ targetReleaseId: release.id, targetAssignedAt: new Date() }).where(eq(schema.gateways.id, gateway.id));
    const [stored] = await db.select({ version: schema.gatewayReleases.version, bundle: schema.gatewayReleases.bundle })
      .from(schema.gateways)
      .innerJoin(schema.gatewayReleases, eq(schema.gatewayReleases.id, schema.gateways.targetReleaseId))
      .where(eq(schema.gateways.id, gateway.id));
    assert.equal(stored.version, "1.3.0");
    assert.equal(sha256Hex(Buffer.from(stored.bundle)), sha256Hex(bundle));
    await db.delete(schema.gatewayReleases).where(eq(schema.gatewayReleases.id, release.id));
    const [after] = await db.select({ targetReleaseId: schema.gateways.targetReleaseId }).from(schema.gateways).where(eq(schema.gateways.id, gateway.id));
    assert.equal(after.targetReleaseId, null, "deleting a release clears the assignment");
  } finally {
    await client.close();
  }
});
