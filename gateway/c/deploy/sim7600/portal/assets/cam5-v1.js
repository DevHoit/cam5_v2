(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let auth = null;

  async function api(url, options = {}) {
    const r = await fetch(url, { cache: "no-store", credentials: "same-origin", ...options });
    const data = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    if (r.status === 401) { location.href = "login.html"; throw new Error("Sesión expirada"); }
    if (!r.ok || data.ok === false) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  }
  async function getAuth() {
    if (auth) return auth;
    auth = await api("/cgi-bin/auth_status.cgi");
    if (!auth.authenticated) { location.href = "login.html"; throw new Error("Sesión requerida"); }
    return auth;
  }
  async function post(body) {
    const a = await getAuth();
    return api("/cgi-bin/cam5_action.cgi", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-HOIT-CSRF": a.csrf },
      body: new URLSearchParams(body).toString(),
    });
  }
  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function set(id, text, cls) { const el = $(id); el.textContent = text; el.className = cls || ""; }

  // "2026-11-13T01:25:49.746Z INFO accepted CAM5-CTRL-01 scheduled: 17 registro(s)"
  function ago(line, now) {
    const t = Date.parse((line || "").split(" ")[0]);
    if (!t) return null;
    return Math.max(0, Math.round((Date.parse(now) - t) / 1000));
  }
  function human(sec) {
    if (sec == null) return "—";
    if (sec < 90) return `hace ${sec} s`;
    if (sec < 5400) return `hace ${Math.round(sec / 60)} min`;
    return `hace ${Math.round(sec / 3600)} h`;
  }

  async function load() {
    try {
      const d = await api("/cgi-bin/cam5_status.cgi");
      set("kService", d.service === "running" ? "En ejecución" : "Detenido", d.service === "running" ? "c5-ok" : "c5-err");
      $("kVersion").textContent = d.version || "—";

      const age = ago(d.last_ok, d.now);
      set("kLastOk", human(age), age == null ? "c5-err" : age < 600 ? "c5-ok" : "c5-warn");
      $("kLastOkDetail").textContent = d.last_ok ? d.last_ok.replace(/^\S+ INFO /, "") : "Sin envíos en el registro";

      set("kQueue", `${d.queue} lote(s)`, d.queue > 5 ? "c5-warn" : "c5-ok");
      $("kRejected").textContent = `${d.rejected} rechazado(s) archivados`;

      const up = { wlan1: "Wi-Fi", rmnet_data0: "4G" }[d.uplink] || d.uplink || "Sin salida";
      set("kUplink", up, d.uplink ? "c5-ok" : "c5-err");
      $("kLte").textContent = `4G: ${d.lte_state || "sin datos"}`;

      $("cfgList").innerHTML = [
        `Portal: <b>${esc(d.api_base || "—")}</b>`,
        `Token: ${d.token_configured ? "configurado" : "<span class='c5-err'>falta</span>"}`,
        `IP Ethernet: ${esc(d.eth_addr || "—")}`,
        `IP forzadas: ${esc(d.host_overrides || "ninguna")}`,
      ].map((x) => `<li>${x}</li>`).join("");

      const ctrls = (d.controllers || "").split("\n").filter(Boolean);
      $("ctrlList").innerHTML = ctrls.length ? ctrls.map((c) => `<li>${esc(c)}</li>`).join("") : "<li>Sin controladores en el registro</li>";

      $("lastProblem").textContent = d.last_problem || "Sin advertencias.";
      const box = $("logBox");
      box.textContent = d.log || "Registro vacío.";
      box.scrollTop = box.scrollHeight;
    } catch (e) {
      set("kService", "Error", "c5-err");
      $("kVersion").textContent = e.message;
    }
  }

  $("refreshBtn").addEventListener("click", load);
  $("restartBtn").addEventListener("click", async () => {
    if (!confirm("¿Reiniciar el servicio cam5-gateway? Las lecturas se reanudan en unos segundos.")) return;
    const b = $("restartBtn"); b.disabled = true;
    try { await post({ action: "restart" }); } catch (e) { alert(e.message); }
    b.disabled = false; setTimeout(load, 3000);
  });
  $("probeBtn").addEventListener("click", async () => {
    const b = $("probeBtn"); b.disabled = true;
    $("probeOut").textContent = "Leyendo…";
    try {
      const r = await post({ action: "probe", target: $("probeTarget").value.trim(), unit: $("probeUnit").value.trim() });
      $("probeOut").textContent = r.output || `Sin salida (código ${r.exit_code})`;
    } catch (e) { $("probeOut").textContent = `Error: ${e.message}`; }
    b.disabled = false;
  });

  load();
  setInterval(load, 30000);
})();
