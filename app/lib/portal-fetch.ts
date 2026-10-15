/** Bounded, memory-only cache. Never stores authentication responses or mutations. */
type Snapshot = { body: ArrayBuffer; status: number; statusText: string; headers: [string, string][]; expires: number };
type Sample = { path: string; durationMs: number; source: "network" | "cache" | "shared"; status: number };
export function createPortalTransport(network: typeof fetch = fetch, clock = () => performance.now()) {
  let generation = 0;
  let context: { userId: string; siteId: string } | null = null;
  const cache = new Map<string, Snapshot>();
  const pending = new Map<string, Promise<Snapshot>>();
  const controllers = new Set<AbortController>();
  const samples: Sample[] = [];
  function clear() {
    generation++; cache.clear(); pending.clear();
    for (const controller of controllers) controller.abort();
    controllers.clear();
  }
  function setContext(next: typeof context) {
    if (next?.userId !== context?.userId || next?.siteId !== context?.siteId) clear();
    context = next;
  }
  function ttl(path: string) {
    if (path === "/api/v1/hierarchy" || /^\/api\/v1\/(electrical|ats|cold-chain)\/configuration$/.test(path)) return 15000;
    if (path === "/api/v1/telemetry/metrics/latest") return 2000;
    return 0;
  }
  function observe(path: string, start: number, source: Sample["source"], status: number) {
    samples.push({ path, durationMs: Math.round(clock() - start), source, status });
    if (samples.length > 100) samples.shift();
  }
  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!path.startsWith("/api/v1/")) return network(path, init);
    if (init.signal?.aborted) throw new DOMException("Consulta cancelada", "AbortError");
    const method = (init.method ?? "GET").toUpperCase();
    const route = path.split("?")[0];
    const auth = route.startsWith("/api/v1/auth/");
    const read = method === "GET" && !auth && !new URLSearchParams(path.split("?")[1]).has("format");
    const start = clock();
    const headers = new Headers(init.headers);
    if (method === "GET") headers.delete("Content-Type");
    if (context && !auth) headers.set("X-Hoit-Site", context.siteId);
    if (!read) {
      if (method !== "GET") clear();
      try {
        const response = await network(path, { ...init, credentials: "include", headers });
        observe(route, start, "network", response.status);
        return response;
      } finally { if (method !== "GET") clear(); }
    }
    const epoch = generation;
    const key = `${epoch}:${path}:${JSON.stringify(Array.from(headers.entries()))}`;
    const saved = cache.get(key);
    let source: Sample["source"] = "network";
    let promise: Promise<Snapshot>;
    if (saved && saved.expires > clock()) { source = "cache"; promise = Promise.resolve(saved); }
    else if (pending.has(key)) { source = "shared"; promise = pending.get(key)!; }
    else {
      cache.delete(key);
      const controller = new AbortController(); controllers.add(controller);
      promise = (async () => {
        const response = await network(path, { ...init, credentials: "include", headers, signal: controller.signal });
        const body = await response.arrayBuffer();
        const snapshot = { body, status: response.status, statusText: response.statusText, headers: Array.from(response.headers.entries()), expires: clock() + ttl(route) };
        if (generation !== epoch) throw new DOMException("Contexto cambiado", "AbortError");
        if ([401, 403, 409, 428].includes(response.status)) cache.clear();
        if (response.ok && context && ttl(route) && body.byteLength < 1_000_000) {
          cache.set(key, snapshot);
          if (cache.size > 40) cache.delete(cache.keys().next().value!);
        }
        return snapshot;
      })().finally(() => { controllers.delete(controller); if (pending.get(key) === promise) pending.delete(key); });
      pending.set(key, promise);
    }
    // A component may cancel its subscription without canceling other consumers.
    const snapshot = await new Promise<Snapshot>((resolve, reject) => {
      const abort = () => reject(new DOMException("Consulta cancelada", "AbortError"));
      if (init.signal?.aborted) { promise.catch(() => {}); abort(); return; }
      init.signal?.addEventListener("abort", abort, { once: true });
      promise.then(resolve, reject).finally(() => init.signal?.removeEventListener("abort", abort));
    });
    if (generation !== epoch) throw new DOMException("Contexto cambiado", "AbortError");
    observe(route, start, source, snapshot.status);
    return new Response(snapshot.status === 204 ? null : snapshot.body, { status: snapshot.status, statusText: snapshot.statusText, headers: snapshot.headers });
  }
  return { request, clear, setContext, measurements: () => samples.map((s) => ({ ...s })) };
}
const transport = createPortalTransport();
export const portalFetch = transport.request;
export const clearPortalCache = transport.clear;
export const setPortalContext = transport.setContext;
export const portalMeasurements = transport.measurements;
if (typeof window !== "undefined") {
  // Do not reuse data after another tab may have changed session/context/permissions.
  window.addEventListener("focus", clearPortalCache);
  window.addEventListener("pagehide", clearPortalCache);
}
