"use strict";
(function () {
  if (!document.body || document.body.dataset.page !== "time-settings") return;

  const $ = (id) => document.getElementById(id);
  const state = {
    auth:null,
    data:null,
    clockBaseEpoch:0,
    clockLoadedAt:0,
    offsetMinutes:0,
    timer:null
  };

  const MODE_LABELS = {
    auto:"Automática",
    ntp:"NTP",
    cellular:"Red celular",
    manual:"Manual"
  };

  const SOURCE_LABELS = {
    ntp:"NTP",
    cellular:"Red celular",
    manual:"Manual",
    none:"Sin fuente"
  };

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[character]));
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function dateText(epoch) {
    const value = number(epoch);
    if (value <= 0) return "—";
    return new Date(value * 1000).toLocaleString();
  }

  function offsetLabel(minutes) {
    const value = number(minutes);
    const sign = value < 0 ? "-" : "+";
    const absolute = Math.abs(value);
    return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  }

  function formatFixedOffset(epochSeconds, offsetMinutes) {
    const date = new Date((number(epochSeconds) + number(offsetMinutes) * 60) * 1000);

    return {
      date:`${String(date.getUTCDate()).padStart(2, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${date.getUTCFullYear()}`,
      time:`${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}:${String(date.getUTCSeconds()).padStart(2, "0")}`,
      input:`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}T${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}:${String(date.getUTCSeconds()).padStart(2, "0")}`
    };
  }

  function formatUtc(epochSeconds) {
    const date = new Date(number(epochSeconds) * 1000);

    return {
      date:`${String(date.getUTCDate()).padStart(2, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${date.getUTCFullYear()}`,
      time:`${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}:${String(date.getUTCSeconds()).padStart(2, "0")}`
    };
  }

  function toast(message, error = false) {
    const root = $("toast");
    $("toastMsg").textContent = message;
    const dot = root.querySelector(".dot");
    if (dot) dot.style.background = error ? "var(--err)" : "var(--ok)";
    root.classList.add("show");
    clearTimeout(root._timer);
    root._timer = setTimeout(() => root.classList.remove("show"), 4500);
  }

  async function getAuth() {
    if (window.HOIT_AUTH?.csrf) return window.HOIT_AUTH;

    if (window.HOIT_AUTH_READY) {
      try {
        const auth = await window.HOIT_AUTH_READY;
        if (auth?.csrf) return auth;
      } catch (_) {}
    }

    const response = await fetch("/cgi-bin/auth_status.cgi", { cache:"no-store" });
    const data = await response.json();

    if (!response.ok || !data.authenticated || !data.csrf) {
      throw new Error("La sesión no es válida");
    }

    return data;
  }

  async function api(url, options = {}) {
    const response = await fetch(url, { cache:"no-store", ...options });
    let data = {};

    try { data = await response.json(); } catch (_) {}

    if (response.status === 401) {
      location.replace(`/login.html?next=${encodeURIComponent(location.pathname)}`);
      throw new Error("Sesión expirada");
    }

    if (!response.ok || data.ok !== true) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    return data;
  }

  async function post(values) {
    state.auth = state.auth || await getAuth();

    return api("/cgi-bin/time_settings_action.cgi", {
      method:"POST",
      headers:{
        "Content-Type":"application/x-www-form-urlencoded;charset=UTF-8",
        "X-HOIT-CSRF":state.auth.csrf
      },
      body:new URLSearchParams(values)
    });
  }

  function populateOffsets(select) {
    select.innerHTML = "";

    for (let minutes = -720; minutes <= 840; minutes += 15) {
      const option = document.createElement("option");
      option.value = String(minutes);
      option.textContent = offsetLabel(minutes);
      select.appendChild(option);
    }
  }

  function tick() {
    if (state.clockBaseEpoch <= 0) return;

    const epoch = state.clockBaseEpoch + Math.floor((Date.now() - state.clockLoadedAt) / 1000);
    const local = formatFixedOffset(epoch, state.offsetMinutes);
    const utc = formatUtc(epoch);

    $("currentLocalTime").textContent = local.time;
    $("currentLocalDate").textContent = local.date;
    $("currentUtcTime").textContent = utc.time;
    $("currentUtcDate").textContent = utc.date;
    $("currentOffsetLabel").textContent = offsetLabel(state.offsetMinutes);
  }

  function setManualDefault(epoch, offset) {
    if ($("manualDatetime").dataset.edited === "1") return;
    $("manualDatetime").value = formatFixedOffset(epoch, offset).input;
  }

  function modeWarning() {
    const mode = $("timeMode").value;
    const warning = $("modeWarning");

    if (mode === "auto") {
      warning.textContent = "El modo automático prueba NTP y puede usar AT+CCLK? como respaldo cuando esa opción está habilitada.";
    } else if (mode === "ntp") {
      warning.textContent = "NTP usa UDP/123 mediante la ruta activa. El protocolo NTP de esta versión no incluye autenticación criptográfica.";
    } else if (mode === "cellular") {
      warning.textContent = "La hora celular consulta AT+CCLK? en /dev/smd8. La operación usa un lock local, pero comparte el módem con otros servicios AT.";
    } else {
      warning.textContent = "El modo manual conserva el reloj definido y no ejecuta sincronizaciones automáticas.";
    }

    const automatic = mode !== "manual";
    $("ntpServers").disabled = mode === "cellular" || !automatic;
    $("syncInterval").disabled = !automatic;
    $("retryInterval").disabled = !automatic;
    $("ntpTimeout").disabled = !automatic;
    $("cellularFallback").disabled = mode !== "auto";
    $("syncNowBtn").disabled = mode === "manual";
  }

  function render(data) {
    state.data = data;

    const config = data.config || {};
    const status = data.status || {};
    const epoch = number(status.system_epoch);
    const offset = number(config.utc_offset_minutes, number(status.utc_offset_minutes));

    state.clockBaseEpoch = epoch;
    state.clockLoadedAt = Date.now();
    state.offsetMinutes = offset;

    $("timeMode").value = config.mode || "ntp";
    $("utcOffset").value = String(offset);
    $("manualOffset").value = String(offset);
    $("ntpServers").value = config.ntp_servers || "";
    $("syncInterval").value = String(config.sync_interval_sec || 21600);
    $("retryInterval").value = String(config.retry_interval_sec || 60);
    $("ntpTimeout").value = String(config.ntp_timeout_sec || 8);
    $("cellularDevice").value = config.cellular_device || "/dev/smd8";
    $("cellularFallback").checked = config.cellular_fallback === true;

    $("modeValue").textContent = MODE_LABELS[status.mode || config.mode] || status.mode || config.mode || "—";
    $("sourceValue").textContent = SOURCE_LABELS[status.source] || status.source || "Sin fuente";
    $("syncValue").textContent = status.synchronized ? "Sincronizado" : "Pendiente";
    $("syncDetail").textContent = status.last_sync_epoch ? dateText(status.last_sync_epoch) : "Sin sincronización registrada";
    $("nextSyncValue").textContent = status.next_sync_epoch ? dateText(status.next_sync_epoch) : "Manual";

    $("serviceState").textContent = data.service_running ? "Activo" : "Detenido";
    $("lastAttempt").textContent = dateText(status.last_attempt_epoch);
    $("lastSuccess").textContent = dateText(status.last_sync_epoch);
    $("lastServer").textContent = status.server || "—";
    $("lastResult").textContent = status.result || "—";

    $("timeDot").className = `dot ${data.service_running && status.synchronized ? "ok" : data.service_running ? "warn" : "err"}`;
    $("timeHealth").textContent = data.service_running
      ? status.synchronized ? "Reloj sincronizado" : "Servicio activo"
      : "Servicio detenido";
    $("timeCrumb").textContent = `${offsetLabel(offset)} · ${MODE_LABELS[config.mode] || config.mode}`;

    setManualDefault(epoch, offset);
    modeWarning();
    tick();
  }

  async function load() {
    try {
      $("refreshBtn").disabled = true;
      render(await api("/cgi-bin/time_settings.cgi"));
    } catch (error) {
      toast(`No fue posible actualizar la hora: ${error.message}`, true);
    } finally {
      $("refreshBtn").disabled = false;
    }
  }

  populateOffsets($("utcOffset"));
  populateOffsets($("manualOffset"));

  $("manualDatetime").addEventListener("input", () => {
    $("manualDatetime").dataset.edited = "1";
  });

  $("timeMode").addEventListener("change", modeWarning);
  $("refreshBtn").addEventListener("click", load);

  $("saveConfigBtn").addEventListener("click", async () => {
    try {
      $("saveConfigBtn").disabled = true;

      const result = await post({
        action:"save",
        mode:$("timeMode").value,
        utc_offset_minutes:$("utcOffset").value,
        ntp_servers:$("ntpServers").value.trim().replace(/\s+/g, ""),
        sync_interval_sec:$("syncInterval").value,
        retry_interval_sec:$("retryInterval").value,
        ntp_timeout_sec:$("ntpTimeout").value,
        cellular_device:$("cellularDevice").value,
        cellular_fallback:$("cellularFallback").checked ? "1" : "0"
      });

      toast(result.message);
      await load();
    } catch (error) {
      toast(error.message, true);
    } finally {
      $("saveConfigBtn").disabled = false;
    }
  });

  $("setManualBtn").addEventListener("click", async () => {
    try {
      $("setManualBtn").disabled = true;

      const result = await post({
        action:"manual",
        local_datetime:$("manualDatetime").value,
        utc_offset_minutes:$("manualOffset").value
      });

      $("manualDatetime").dataset.edited = "0";
      toast(result.message);
      await load();
    } catch (error) {
      toast(error.message, true);
    } finally {
      $("setManualBtn").disabled = false;
    }
  });

  $("syncNowBtn").addEventListener("click", async () => {
    try {
      $("syncNowBtn").disabled = true;
      toast("Consultando la fuente de tiempo…");
      const result = await post({ action:"sync" });
      toast(result.message);
      await load();
    } catch (error) {
      toast(error.message, true);
    } finally {
      modeWarning();
    }
  });

  getAuth().then((auth) => { state.auth = auth; }).catch(() => {});
  load();
  state.timer = window.setInterval(tick, 1000);
  window.setInterval(load, 15000);
})();