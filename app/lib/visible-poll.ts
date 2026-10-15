/** Serial polling: hidden tabs do no work; slow responses never overlap. */
export function pollVisible(task: () => Promise<unknown>, intervalMs: number, immediate = true) {
  let stopped = false, running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    if (stopped || running || document.hidden) return;
    running = true;
    try { await task(); } catch { /* Consumers own their visible error state. */ }
    finally {
      running = false;
      if (!stopped && !document.hidden) timer = setTimeout(() => void tick(), intervalMs);
    }
  };
  const visibility = () => {
    clearTimeout(timer);
    if (!document.hidden) void tick();
  };
  document.addEventListener("visibilitychange", visibility);
  if (immediate) void tick(); else timer = setTimeout(() => void tick(), intervalMs);
  return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
}
