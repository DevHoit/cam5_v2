import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { pollWhileVisible } from "../app/poll-while-visible";

test("polls only while the tab is visible and catches up when it comes back", () => {
  mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 });
  let visibility: "visible" | "hidden" = "visible";
  const listeners = new Set<() => void>();
  const g = globalThis as unknown as { window: unknown; document: unknown };
  g.window = globalThis;
  g.document = {
    get visibilityState() { return visibility; },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  const setVisibility = (value: typeof visibility) => { visibility = value; for (const listener of listeners) listener(); };
  try {
    let calls = 0;
    const stop = pollWhileVisible(() => { calls += 1; }, 10_000);
    mock.timers.tick(30_000);
    assert.equal(calls, 3, "visible: una consulta cada 10 s");

    setVisibility("hidden");
    mock.timers.tick(120_000);
    assert.equal(calls, 3, "oculta: no consulta");

    setVisibility("visible");
    assert.equal(calls, 4, "al volver refresca de inmediato");

    setVisibility("hidden");
    setVisibility("visible");
    assert.equal(calls, 4, "no repite si aún no pasa el intervalo");

    stop();
    mock.timers.tick(60_000);
    setVisibility("hidden");
    setVisibility("visible");
    assert.equal(calls, 4, "detenido no consulta");
    assert.equal(listeners.size, 0);
  } finally {
    mock.timers.reset();
    delete (g as Partial<typeof g>).window;
    delete (g as Partial<typeof g>).document;
  }
});
