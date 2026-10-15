import assert from "node:assert/strict";
import test from "node:test";
import { createPortalTransport } from "../app/lib/portal-fetch";
import { pollVisible } from "../app/lib/visible-poll";
const json = (value: unknown, status = 200) => Response.json(value, { status });

test("parallel consumers share one request; cache is bounded by TTL and invalidated by writes", async () => {
  let calls = 0, now = 0;
  const transport = createPortalTransport(async () => { calls++; return json({ calls }); }, () => now);
  transport.setContext({ userId: "u", siteId: "a" });
  const path = "/api/v1/telemetry/metrics/latest?assetId=A";
  const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => transport.request(path, i % 2 ? { headers: { "Content-Type": "application/json" } } : {})));
  assert.equal(calls, 1);
  for (const r of responses) assert.deepEqual(await r.json(), { calls: 1 });
  await transport.request(path); assert.equal(calls, 1);
  now = 2001; await transport.request(path); assert.equal(calls, 2);
  await transport.request("/api/v1/sensors", { method: "PATCH", body: "{}" });
  await transport.request(path); assert.equal(calls, 4);
  assert.equal(transport.measurements().filter((s) => s.source === "shared").length, 19);
});

test("changing context rejects late responses and sends expected-site header", async () => {
  let finish!: (r: Response) => void;
  const sites: Array<string | null> = [];
  const transport = createPortalTransport(async (_path, init) => {
    sites.push(new Headers(init?.headers).get("x-hoit-site"));
    return sites.length === 1 ? new Promise<Response>((resolve) => { finish = resolve; }) : json({ site: sites.at(-1) });
  });
  transport.setContext({ userId: "u", siteId: "a" });
  const old = transport.request("/api/v1/hierarchy");
  const rejected = assert.rejects(old, { name: "AbortError" });
  transport.setContext({ userId: "u", siteId: "b" });
  finish(json({ site: "a" })); await rejected;
  assert.deepEqual(await (await transport.request("/api/v1/hierarchy")).json(), { site: "b" });
  assert.deepEqual(sites, ["a", "b"]);
});

test("one subscriber can abort without cancelling other consumers; auth, errors and exports are not cached", async () => {
  let calls = 0;
  let finish!: (r: Response) => void;
  const transport = createPortalTransport(async () => { calls++; return calls === 1 ? new Promise<Response>((r) => { finish = r; }) : json({ calls }, 403); });
  transport.setContext({ userId: "u", siteId: "a" });
  const abort = new AbortController();
  const first = transport.request("/api/v1/hierarchy", { signal: abort.signal });
  const rejected = assert.rejects(first, { name: "AbortError" });
  const second = transport.request("/api/v1/hierarchy");
  abort.abort(); await rejected; finish(json({ ok: true }));
  assert.deepEqual(await (await second).json(), { ok: true }); assert.equal(calls, 1);
  transport.clear();
  await transport.request("/api/v1/hierarchy"); await transport.request("/api/v1/hierarchy"); assert.equal(calls, 3);
  await transport.request("/api/v1/auth/session"); await transport.request("/api/v1/auth/session"); assert.equal(calls, 5);
  await transport.request("/api/v1/history?format=csv"); await transport.request("/api/v1/history?format=csv"); assert.equal(calls, 7);
});

test("polling waits for completion, pauses hidden tabs and cleans up", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const prior = Object.getOwnPropertyDescriptor(globalThis, "document");
  const listeners = new Set<() => void>();
  const doc = { hidden: false, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  let calls = 0, finish!: () => void;
  const stop = pollVisible(() => { calls++; return new Promise<void>((resolve) => { finish = resolve; }); }, 100);
  try {
    assert.equal(calls, 1); t.mock.timers.tick(500); assert.equal(calls, 1);
    finish(); await Promise.resolve(); await Promise.resolve();
    doc.hidden = true; for (const fn of listeners) fn(); t.mock.timers.tick(500); assert.equal(calls, 1);
    doc.hidden = false; for (const fn of listeners) fn(); assert.equal(calls, 2);
    stop(); finish(); await Promise.resolve(); t.mock.timers.tick(500); assert.equal(calls, 2); assert.equal(listeners.size, 0);
  } finally { stop(); if (prior) Object.defineProperty(globalThis, "document", prior); else Reflect.deleteProperty(globalThis, "document"); }
});

test("shared responses preserve binary downloads without converting bytes to text", async () => {
  const bytes = new Uint8Array([0, 255, 128, 80, 68, 70]);
  const transport = createPortalTransport(async () => new Response(bytes, { headers: { "Content-Type": "application/pdf" } }));
  const [a, b] = await Promise.all([transport.request("/api/v1/reports/download"), transport.request("/api/v1/reports/download")]);
  assert.deepEqual(new Uint8Array(await a.arrayBuffer()), bytes);
  assert.deepEqual(new Uint8Array(await b.arrayBuffer()), bytes);
});

test("an uncertain mutation invalidates reads even when its network response fails", async () => {
  let reads = 0;
  let fail!: (error: Error) => void;
  const transport = createPortalTransport(async (_path, init) => {
    if (init?.method === "PATCH") return new Promise<Response>((_resolve, reject) => { fail = reject; });
    return json({ reads: ++reads });
  });
  transport.setContext({ userId: "u", siteId: "a" });
  await transport.request("/api/v1/hierarchy");
  const write = transport.request("/api/v1/sensors", { method: "PATCH" });
  const rejected = assert.rejects(write, /network/);
  await transport.request("/api/v1/hierarchy");
  fail(new Error("network")); await rejected;
  await transport.request("/api/v1/hierarchy");
  assert.equal(reads, 3);
});
