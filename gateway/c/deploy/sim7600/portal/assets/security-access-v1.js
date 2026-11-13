"use strict";
(function () {
  if (!document.body || document.body.dataset.page !== "security-access") return;

  const $ = (id) => document.getElementById(id);
  const state = {
    auth:null,
    data:null,
    editing:null,
    deleting:null
  };

  const ROLE_LABELS = {
    admin:"Administrador",
    operator:"Operador",
    viewer:"Solo lectura"
  };

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[character]));
  }

  function toast(message, error = false) {
    const root = $("toast");
    $("toastMsg").textContent = message;
    const dot = root.querySelector(".dot");

    if (dot) {
      dot.style.background = error ? "var(--err)" : "var(--ok)";
    }

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

    try {
      data = await response.json();
    } catch (_) {}

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

    return api("/cgi-bin/security_users_action.cgi", {
      method:"POST",
      headers:{
        "Content-Type":"application/x-www-form-urlencoded;charset=UTF-8",
        "X-HOIT-CSRF":state.auth.csrf
      },
      body:new URLSearchParams(values)
    });
  }

  function findUser(username) {
    return state.data?.users?.find((user) => user.username === username) || null;
  }

  function renderUsers(users) {
    const root = $("userList");

    if (!users?.length) {
      root.innerHTML = `<div class="security-empty">No hay usuarios configurados.</div>`;
      return;
    }

    root.innerHTML = users.map((user) => `
      <article class="security-user ${user.enabled ? "" : "disabled"}">
        <div class="security-user-head">
          <div>
            <h4>${esc(user.username)}${user.current ? " · sesión actual" : ""}</h4>
            <small>${user.enabled ? "Cuenta habilitada" : "Cuenta deshabilitada"}${user.must_change ? " · cambio de contraseña pendiente" : ""}</small>
          </div>
          <span class="security-role ${esc(user.role)}">${esc(ROLE_LABELS[user.role] || user.role)}</span>
        </div>

        <div class="security-user-meta">
          <div><span>Sesiones</span><b>${Number(user.sessions || 0)}</b></div>
          <div><span>Estado</span><b>${user.enabled ? "Habilitado" : "Deshabilitado"}</b></div>
          <div><span>Contraseña</span><b>${user.must_change ? "Cambio obligatorio" : "Configurada"}</b></div>
        </div>

        <div class="security-user-actions">
          <button class="btn ghost sm" type="button" data-edit="${esc(user.username)}">Editar</button>
          <button class="btn ghost sm" type="button" data-logout="${esc(user.username)}">Cerrar sesiones</button>
          ${user.current ? "" : `<button class="btn ghost sm" type="button" data-delete="${esc(user.username)}">Eliminar</button>`}
        </div>
      </article>
    `).join("");

    root.querySelectorAll("[data-edit]").forEach((button) => {
      button.addEventListener("click", () => openUser(findUser(button.dataset.edit)));
    });

    root.querySelectorAll("[data-logout]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const result = await post({
            action:"logout_user",
            username:button.dataset.logout
          });
          toast(result.message);
          await load();
        } catch (error) {
          toast(error.message, true);
        }
      });
    });

    root.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        state.deleting = button.dataset.delete;
        $("deleteMessage").textContent = `Se eliminará la cuenta ${state.deleting}.`;
        $("deleteModal").classList.add("show");
      });
    });
  }

  function render(data) {
    state.data = data;

    const users = data.users || [];
    const enabledAdmins = users.filter((user) => user.role === "admin" && user.enabled).length;
    const sessions = users.reduce((total, user) => total + Number(user.sessions || 0), 0);
    const policy = data.policy || {};

    $("userCount").textContent = users.length;
    $("adminCount").textContent = enabledAdmins;
    $("sessionCount").textContent = sessions;
    $("currentUser").textContent = data.current_user || "—";
    $("currentRole").textContent = ROLE_LABELS[data.current_role] || data.current_role || "—";
    $("securityCrumb").textContent = `${users.length} usuario(s) · ${sessions} sesión(es)`;

    $("sessionTtl").value = String(policy.session_ttl || 28800);
    $("passwordMin").value = String(policy.password_min_length || 12);
    $("maxFailures").value = String(policy.max_failures || 5);
    $("failureWindow").value = String(policy.failure_window || 300);
    $("lockoutSeconds").value = String(policy.lockout_seconds || 120);

    renderUsers(users);
  }

  async function load() {
    try {
      $("refreshBtn").disabled = true;
      render(await api("/cgi-bin/security_users.cgi"));
    } catch (error) {
      toast(`No fue posible actualizar seguridad: ${error.message}`, true);
    } finally {
      $("refreshBtn").disabled = false;
    }
  }

  function openUser(user = null) {
    state.editing = user?.username || null;

    $("userModalTitle").textContent = user ? "Editar usuario" : "Nuevo usuario";
    $("username").value = user?.username || "";
    $("username").disabled = user?.current === true;
    $("userRole").value = user?.role || "operator";
    $("userRole").disabled = user?.current === true;
    $("userPassword").value = "";
    $("userEnabled").checked = user ? user.enabled === true : true;
    $("userEnabled").disabled = user?.current === true;
    $("userMustChange").checked = user ? user.must_change === true : true;
    $("passwordHelp").textContent = user
      ? "Déjala vacía para conservar la contraseña actual."
      : "Obligatoria para usuarios nuevos.";

    $("userModal").classList.add("show");
  }

  $("newUserBtn").addEventListener("click", () => openUser());
  $("refreshBtn").addEventListener("click", () => { load(); loadNet(); });

  $("cancelUserBtn").addEventListener("click", () => {
    $("userModal").classList.remove("show");
  });

  $("userModal").addEventListener("click", (event) => {
    if (event.target === $("userModal")) {
      $("userModal").classList.remove("show");
    }
  });

  $("saveUserBtn").addEventListener("click", async () => {
    try {
      $("saveUserBtn").disabled = true;

      const result = await post({
        action:"save_user",
        original_username:state.editing || "",
        username:$("username").value.trim(),
        role:$("userRole").value,
        password:$("userPassword").value,
        enabled:$("userEnabled").checked ? "1" : "0",
        must_change:$("userMustChange").checked ? "1" : "0"
      });

      $("userModal").classList.remove("show");
      toast(result.message);
      await load();
    } catch (error) {
      toast(error.message, true);
    } finally {
      $("saveUserBtn").disabled = false;
    }
  });

  $("cancelDeleteBtn").addEventListener("click", () => {
    $("deleteModal").classList.remove("show");
  });

  $("deleteModal").addEventListener("click", (event) => {
    if (event.target === $("deleteModal")) {
      $("deleteModal").classList.remove("show");
    }
  });

  $("confirmDeleteBtn").addEventListener("click", async () => {
    if (!state.deleting) return;

    try {
      $("confirmDeleteBtn").disabled = true;

      const result = await post({
        action:"delete_user",
        username:state.deleting
      });

      $("deleteModal").classList.remove("show");
      toast(result.message);
      await load();
    } catch (error) {
      toast(error.message, true);
    } finally {
      $("confirmDeleteBtn").disabled = false;
    }
  });

  $("logoutOthersBtn").addEventListener("click", async () => {
    try {
      $("logoutOthersBtn").disabled = true;
      const result = await post({ action:"logout_others" });
      toast(result.message);
      await load();
    } catch (error) {
      toast(error.message, true);
    } finally {
      $("logoutOthersBtn").disabled = false;
    }
  });

  $("savePolicyBtn").addEventListener("click", async () => {
    try {
      $("savePolicyBtn").disabled = true;

      const result = await post({
        action:"save_policy",
        session_ttl:$("sessionTtl").value,
        password_min_length:$("passwordMin").value,
        max_failures:$("maxFailures").value,
        failure_window:$("failureWindow").value,
        lockout_seconds:$("lockoutSeconds").value
      });

      toast(result.message);
      await load();
    } catch (error) {
      toast(error.message, true);
    } finally {
      $("savePolicyBtn").disabled = false;
    }
  });

  // ---- Acceso desde el Wi-Fi corporativo (cortafuegos) ----------------------

  function netWarning() {
    const net = state.net;
    const warn = $("netWarn");
    if (!net) { warn.hidden = true; return; }

    const fw = net.firewall || {};
    const viaWifi = net.client_interface && net.client_interface === fw.wifi_interface;
    const mode = $("netMode").value;
    const allow = $("netAllow").value.trim().split(/[\s,]+/).filter(Boolean);
    let text = "";

    if (viaWifi && mode === "block") {
      text = "Estás conectado por el Wi-Fi corporativo: al aplicar perderás el acceso al portal. Podrás volver a entrar por el hotspot del gateway o por USB.";
    } else if (viaWifi && allow.length && !allow.includes(net.client_ip)) {
      text = `Tu IP (${net.client_ip}) no está en la lista: al aplicar perderás el acceso desde esta red.`;
    } else if (mode === "temp") {
      text = "Al terminar el plazo, el gateway bloquea el acceso solo (lo revisa cada minuto).";
    }

    warn.textContent = text;
    warn.hidden = !text;
    $("netHoursField").style.display = mode === "temp" ? "" : "none";
  }

  function renderNet(data) {
    state.net = data;
    const fw = data.firewall || {};
    const badge = $("netAccessBadge");
    const until = Number(fw.wifi_admin_until || 0);

    $("netWifiIf").textContent = fw.wifi_interface || "wlan1";
    $("netWifiIp").textContent = fw.wifi_ip || "sin conexión";
    $("netClientIp").textContent = `${data.client_ip || "—"}${data.client_interface ? ` (${data.client_interface})` : ""}`;
    $("netAllow").value = fw.wifi_admin_allow || "";

    if (!fw.wifi_admin) {
      badge.textContent = "Bloqueado";
      badge.className = "security-net-badge closed";
      $("netMode").value = "block";
    } else if (until > 0) {
      badge.textContent = `Permitido hasta ${new Date(until * 1000).toLocaleString([], { dateStyle:"short", timeStyle:"short" })}`;
      badge.className = "security-net-badge temp";
      $("netMode").value = "temp";
    } else {
      badge.textContent = fw.wifi_admin_allow ? "Permitido (IP autorizadas)" : "Permitido";
      badge.className = "security-net-badge open";
      $("netMode").value = "allow";
    }

    netWarning();
  }

  async function loadNet() {
    try {
      renderNet(await api("/cgi-bin/security_network.cgi"));
    } catch (error) {
      $("netAccessBadge").textContent = "No disponible";
      toast(`Acceso por Wi-Fi: ${error.message}`, true);
    }
  }

  $("netMode").addEventListener("change", netWarning);
  $("netAllow").addEventListener("input", netWarning);

  $("saveNetBtn").addEventListener("click", async () => {
    const warning = $("netWarn").hidden ? "" : $("netWarn").textContent;
    if (warning && $("netMode").value !== "temp" && !window.confirm(`${warning}\n\n¿Aplicar de todas formas?`)) return;

    try {
      $("saveNetBtn").disabled = true;
      state.auth = state.auth || await getAuth();

      const result = await api("/cgi-bin/security_network_action.cgi", {
        method:"POST",
        headers:{
          "Content-Type":"application/x-www-form-urlencoded;charset=UTF-8",
          "X-HOIT-CSRF":state.auth.csrf
        },
        body:new URLSearchParams({
          mode:$("netMode").value,
          hours:$("netHours").value,
          allow:$("netAllow").value.trim()
        })
      });

      toast(result.message);
      await loadNet();
    } catch (error) {
      toast(error.message, true);
    } finally {
      $("saveNetBtn").disabled = false;
    }
  });

  getAuth().then((auth) => {
    state.auth = auth;

    if (auth.role && auth.role !== "admin") {
      throw new Error("Esta página requiere rol Administrador");
    }
  }).catch((error) => {
    toast(error.message, true);
  });

  load();
  loadNet();
})();