/**
 * Repite una consulta cada `intervalMs` solo mientras la pestaña está visible. Con la pestaña oculta
 * (otra pestaña, ventana minimizada, pantalla bloqueada) no consulta, para no mantener despierta la
 * base de datos; al volver, refresca de inmediato si ya pasó el intervalo. Quien la usa hace la
 * primera carga por su cuenta. Devuelve la función que detiene el sondeo.
 */
export function pollWhileVisible(task: () => void, intervalMs: number): () => void {
  let lastRun = Date.now();
  const run = () => { lastRun = Date.now(); task(); };
  const timer = window.setInterval(() => { if (document.visibilityState === "visible") run(); }, intervalMs);
  const onVisibility = () => { if (document.visibilityState === "visible" && Date.now() - lastRun >= intervalMs) run(); };
  document.addEventListener("visibilitychange", onVisibility);
  return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
}
