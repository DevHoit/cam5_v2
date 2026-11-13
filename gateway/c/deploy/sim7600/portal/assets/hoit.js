'use strict';
/* HOIT Gateway Portal — lógica común a todas las páginas. */

/* ============ i18n ============ */
const I18N = {
  nav_dash:['Dashboard','Dashboard'], nav_conn:['Conectividad','Connectivity'],
  nav_telem:['Telemetría','Telemetry'], nav_sens:['Dispositivos','Devices'],
  nav_sock:['Puentes TCP','TCP Bridges'],
  nav_sys:['Sistema','System'], nav_diag:['Diagnóstico','Diagnostics'],
  health_ok:['Operativo','Operational'],
  d_hero_t:['El gateway está operando correctamente','The gateway is operating normally'],
  d_hero_s:['Todos los servicios activos. Telemetría enviándose con normalidad.','All services running. Telemetry is being sent normally.'],
  d_route:['Ruta activa','Active route'], d_lastcom:['Última comunicación','Last communication'],
  d_ago12:['hace 12 s','12 s ago'], d_ago3:['hace 3 s','3 s ago'],
  d_conn:['Conectividad','Connectivity'], d_conn_s:['LTE en respaldo · WiFi AP activo','LTE on standby · WiFi AP active'],
  d_srv:['Servidor','Server'], d_srv_s:['Último envío hace 12 s','Last push 12 s ago'],
  d_sens:['Dispositivos','Devices'], d_sens_s:['1 dispositivo instalado','1 installed device'],
  d_gps_s:['11 satélites · ±1,8 m','11 satellites · ±1.8 m'],
  st_conn:['Conectado','Connected'], st_standby:['En espera','Standby'], st_running:['En ejecución','Running'],
  st_ok:['Operativo','Operational'], st_closed:['Cerrado','Closed'], st_active:['Activo','Active'], st_inactive:['Inactivo','Inactive'],
  f_link:['Enlace','Link'], w_clients:['Clientes','Clients'], l_carrier:['Operador','Carrier'],
  g_pos:['Posición','Position'], g_upd:['Actualizado','Updated'],
  d_events:['Eventos recientes','Recent events'], d_viewall:['Ver todos','View all'],
  ev1:['Telemetría enviada correctamente','Telemetry sent successfully'],
  ev2:['Señal LTE degradada (-71 dBm)','LTE signal degraded (-71 dBm)'],
  ev3:['GPS obtuvo fix 3D','GPS acquired 3D fix'],
  ev4:['Cliente WiFi conectado (a4:5e:60:…)','WiFi client connected (a4:5e:60:…)'],
  d_services:['Servicios internos','Internal services'],
  c_sub:['Estado y configuración de las interfaces WAN del gateway.','Status and configuration of the gateway WAN interfaces.'],
  c_prio:['Prioridad de uso (failover)','Usage priority (failover)'],
  c_prio_b:['Failover automático','Automatic failover'], c_inuse:['En uso','In use'],
  c_prio_h:['Si la interfaz prioritaria pierde conexión, el gateway conmutará automáticamente a la siguiente disponible.','If the priority interface loses connection, the gateway will automatically switch to the next available one.'],
  e_cable:['Estado del cable','Cable status'], e_cable_s:['Detectado en puerto WAN','Detected on WAN port'],
  e_speed:['Velocidad del enlace','Link speed'], e_cfg:['Configuración IP','IP configuration'],
  e_ip:['Dirección IP','IP address'], e_ip_h:['Asignada por DHCP. Desactive DHCP para definirla manualmente.','Assigned by DHCP. Disable DHCP to set it manually.'],
  e_mask:['Máscara de subred','Subnet mask'], e_dns_h:['Separar servidores con coma.','Separate servers with commas.'],
  a_test:['Probar conexión','Test connection'], a_save:['Guardar cambios','Save changes'],
  a_cancel:['Cancelar','Cancel'], a_confirm:['Confirmar','Confirm'], a_update:['Actualizar','Refresh'], a_restart:['Reiniciar','Restart'],
  w_mode:['Modo de operación','Operating mode'], w_mode_l:['Modo','Mode'], w_client:['Cliente','Client'],
  w_mode_h:['AP + Cliente disponible según capacidad del hardware.','AP + Client available depending on hardware capability.'],
  w_pass:['Contraseña','Password'], w_pass_h:['Mínimo 8 caracteres.','Minimum 8 characters.'],
  w_sec:['Seguridad','Security'], w_clients_t:['Clientes conectados','Connected clients'],
  w_dev:['Dispositivo','Device'], w_sig:['Señal','Signal'],
  w_scan:['Redes disponibles','Available networks'], w_rescan:['Escanear','Scan'], w_connect:['Conectar','Connect'],
  l_reg:['Registrado en red · LTE Cat 4','Registered on network · LTE Cat 4'], l_signal:['Señal','Signal'],
  l_id:['Identificación del módulo','Module identification'],
  l_apn_h:['Provisto por el operador de la SIM.','Provided by the SIM carrier.'],
  l_test:['Probar Internet','Test Internet'], l_reconn:['Reconectar','Reconnect'], l_reboot:['Reiniciar módem','Restart modem'],
  t_sub:['Configuración del envío de datos al servidor HOIT.','Configuration of data delivery to the HOIT server.'],
  t_cfg:['Servidor de destino','Destination server'],
  t_key_h:['Se almacena cifrada en el gateway.','Stored encrypted on the gateway.'],
  t_int:['Intervalo de envío','Send interval'], t_i30:['30 segundos','30 seconds'], t_i60:['60 segundos','60 seconds'], t_i5:['5 minutos','5 minutes'],
  t_retry:['Reintentos','Retries'], t_retry_h:['Con espera exponencial entre intentos.','With exponential backoff between attempts.'],
  t_tls_h:['Verificación de certificado activa','Certificate verification enabled'],
  t_send:['Enviar ahora','Send now'], t_last:['Último envío','Last push'],
  t_when:['Enviado','Sent'], t_lat:['Latencia','Latency'], t_json:['JSON enviado','JSON sent'],
  s_sub:['Anemómetro, entradas digitales y alarmas del gateway.','Anemometer, digital inputs and gateway alarms.'],
  s_anemo:['Anemómetro','Anemometer'], s_speed:['Velocidad actual','Current speed'], s_gust:['Ráfaga (10 min)','Gust (10 min)'],
  s_port:['Puerto','Port'], s_baud:['Velocidad','Baud rate'], s_proto:['Protocolo','Protocol'],
  s_frame:['Última trama recibida (hace 2 s)','Last frame received (2 s ago)'], s_test:['Probar sensor','Test sensor'],
  s_din:['Entradas digitales','Digital inputs'], s_door:['Puerta gabinete','Cabinet door'], s_aux:['Auxiliar','Auxiliary'],
  s_pwr:['Alimentación externa','External power'],
  s_lg_h:['Ante un corte de alimentación, el gateway enviará un último mensaje de alerta usando la energía residual.','On power loss, the gateway will send a final alert message using residual energy.'],
  s_alarms:['Alarmas','Alarms'], s_thr:['Umbral viento alto','High wind threshold'], s_thr2:['Umbral ráfaga','Gust threshold'],
  g_sub:['Posicionamiento GNSS del gateway.','GNSS positioning of the gateway.'],
  g_fix_s:['GPS + GLONASS · 11 satélites','GPS + GLONASS · 11 satellites'], g_acc:['Precisión','Accuracy'],
  g_pos_t:['Última posición','Last position'], g_lat:['Latitud','Latitude'], g_lon:['Longitud','Longitude'],
  g_alt:['Altitud','Altitude'], g_date:['Fecha GNSS','GNSS date'],
  y_sub:['Información y mantenimiento del gateway.','Gateway information and maintenance.'],
  y_model:['Modelo','Model'], y_boot:['Desde 2026-06-29','Since 2026-06-29'],
  y_temp:['Temperatura','Temperature'], y_temp_s:['Dentro de rango','Within range'],
  y_res:['Recursos','Resources'], y_maint:['Mantenimiento','Maintenance'],
  y_export:['Exportar configuración','Export configuration'], y_import:['Importar configuración','Import configuration'],
  y_fw:['Actualizar firmware','Update firmware'], y_reboot:['Reiniciar gateway','Restart gateway'],
  x_sub:['Herramientas técnicas y registros del gateway.','Technical tools and gateway logs.'],
  x_tools:['Herramientas','Tools'], x_target:['Destino','Target'], x_run:['Ejecutar','Run'],
  x_at:['Prueba AT','AT test'], x_gps:['Prueba GPS','GPS test'], x_sens:['Prueba sensores','Sensor test'],
  x_if:['Interfaces','Interfaces'], x_rt:['Rutas','Routes'], x_ps:['Procesos','Processes'],
  x_out:['Resultado','Output'], x_empty:['Ejecute una herramienta para ver el resultado aquí.','Run a tool to see the output here.'],
  x_err_t:['Ejemplo de error explicativo','Example of an explanatory error'],
  x_err_b:['No fue posible resolver «api.hoit.cl». El servidor DNS (192.168.10.1) no respondió. Verifique el cable Ethernet o defina un DNS alternativo en Conectividad → Ethernet.','Could not resolve “api.hoit.cl”. The DNS server (192.168.10.1) did not respond. Check the Ethernet cable or set an alternative DNS in Connectivity → Ethernet.'],
  x_dl:['Descargar log completo','Download full log'],
  x_last:['Últimas líneas (/var/log/hoit.log)','Latest lines (/var/log/hoit.log)'],
  /* Toasts */
  t_saved:['Cambios guardados','Changes saved'],
  t_test_ok:['Conexión correcta: gateway alcanzable (0,4 ms)','Connection OK: gateway reachable (0.4 ms)'],
  t_scan:['Escaneo completado: 2 redes encontradas','Scan complete: 2 networks found'],
  t_wifi_conn:['Ingrese la contraseña para conectar','Enter the password to connect'],
  t_inet_ok:['Internet OK vía LTE (231 ms)','Internet OK via LTE (231 ms)'],
  t_reconn:['Reconectando módem LTE…','Reconnecting LTE modem…'],
  t_sent:['Telemetría enviada: HTTP 200 (184 ms)','Telemetry sent: HTTP 200 (184 ms)'],
  t_sens_ok:['Sensor OK: trama válida recibida','Sensor OK: valid frame received'],
  t_gps_upd:['Posición actualizada','Position updated'],
  t_hot:['Hot Start iniciado, fix en ~5 s','Hot Start initiated, fix in ~5 s'],
  t_svc:['Servicio reiniciado','Service restarted'],
  t_export:['Configuración exportada (hoit-gw-config.json)','Configuration exported (hoit-gw-config.json)'],
  t_import:['Seleccione un archivo de configuración','Select a configuration file'],
  t_log:['Descargando hoit.log (1,2 MB)…','Downloading hoit.log (1.2 MB)…'],
  /* Modales */
  c_modem_t:['¿Reiniciar el módem LTE?','Restart the LTE modem?'],
  c_modem_b:['La conexión LTE se interrumpirá durante ~30 segundos. Si es la ruta activa, el tráfico conmutará a la siguiente interfaz.','The LTE connection will drop for ~30 seconds. If it is the active route, traffic will fail over to the next interface.'],
  c_cold_t:['¿Ejecutar Cold Start del GPS?','Perform a GPS Cold Start?'],
  c_cold_b:['Se borrarán almanaque y efemérides. Obtener un nuevo fix puede tardar varios minutos.','Almanac and ephemeris will be erased. Acquiring a new fix may take several minutes.'],
  c_fw_t:['¿Actualizar el firmware?','Update the firmware?'],
  c_fw_b:['El gateway se reiniciará al finalizar. La operación no debe interrumpirse.','The gateway will restart when finished. The operation must not be interrupted.'],
  c_reboot_t:['¿Reiniciar el gateway?','Restart the gateway?'],
  c_reboot_b:['Todas las conexiones y la telemetría se interrumpirán durante ~60 segundos.','All connections and telemetry will be interrupted for ~60 seconds.'],
  m_done:['Acción ejecutada','Action executed']
};
/* localStorage puede no estar disponible (file://, webviews). Nunca debe romper la página. */
let lang = 0; // 0 = ES, 1 = EN
try { lang = Number(localStorage.getItem('hoit-lang')) || 0; } catch(e) {}
function saveLang(v){ try { localStorage.setItem('hoit-lang', v); } catch(e) {} }
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function applyLang(){
  $$('[data-i18n]').forEach(el=>{
    const k = el.dataset.i18n;
    if(I18N[k]) el.textContent = I18N[k][lang];
  });
  document.documentElement.lang = lang ? 'en' : 'es';
  $('#langEs').classList.toggle('on', lang===0);
  $('#langEn').classList.toggle('on', lang===1);
}
$('#langEs').addEventListener('click', ()=>{ lang=0; saveLang(0); applyLang(); });
$('#langEn').addEventListener('click', ()=>{ lang=1; saveLang(1); applyLang(); });

/* ============ Enlaces internos ============ */
const PAGES = {dash:'index.html', conn:'conectividad.html', telem:'telemetria.html',
               sens:'sensores.html', gps:'gps.html', sys:'sistema.html', diag:'diagnostico.html'};
$$('[data-goto]').forEach(b=>b.addEventListener('click', ()=>location.href = PAGES[b.dataset.goto]));

/* ============ Sidebar móvil ============ */
const sidebar=$('#sidebar'), scrim=$('#scrim');
function closeSidebar(){ sidebar.classList.remove('open'); scrim.classList.remove('show'); }
$('#burger').addEventListener('click', ()=>{ sidebar.classList.add('open'); scrim.classList.add('show'); });
scrim.addEventListener('click', closeSidebar);

/* ============ Tabs (Conectividad) ============ */
$$('.tabs button').forEach(b=>b.addEventListener('click', ()=>{
  $$('.tabs button').forEach(x=>x.classList.remove('on'));
  b.classList.add('on');
  $$('.tabpane').forEach(p=>p.style.display='none');
  $('#tab-'+b.dataset.tab).style.display='block';
}));

/* ============ DHCP (Conectividad) ============ */
const dhcpSw = $('#dhcpSw');
if(dhcpSw) dhcpSw.addEventListener('change', e=>{
  $$('#tab-eth .fgrid input').forEach(i=>i.disabled = e.target.checked);
});

/* ============ Prioridad WAN (Conectividad) ============ */
const prio = $('#prioList');
if(prio) prio.addEventListener('click', e=>{
  const btn = e.target.closest('.mv button'); if(!btn) return;
  const row = btn.closest('.prio-row');
  if(btn.textContent==='↑' && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
  if(btn.textContent==='↓' && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
  [...prio.children].forEach((r,i)=>r.querySelector('.num').textContent=i+1);
});

/* ============ Toast ============ */
let toastT;
function toast(key){
  $('#toastMsg').textContent = I18N[key] ? I18N[key][lang] : key;
  $('#toast').classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(()=>$('#toast').classList.remove('show'), 3200);
}
$$('[data-toast]').forEach(b=>b.addEventListener('click', ()=>toast(b.dataset.toast)));

/* ============ Modal de confirmación ============ */
const overlay=$('#overlay');
function confirmAction(key){
  $('#mTitle').textContent = I18N[key+'_t'][lang];
  $('#mBody').textContent  = I18N[key+'_b'][lang];
  overlay.classList.add('show');
  $('#mOk').onclick = ()=>{ overlay.classList.remove('show'); toast('m_done'); };
}
$$('[data-confirm]').forEach(b=>b.addEventListener('click', ()=>confirmAction(b.dataset.confirm)));
$('#mCancel').addEventListener('click', ()=>overlay.classList.remove('show'));
overlay.addEventListener('click', e=>{ if(e.target===overlay) overlay.classList.remove('show'); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape') overlay.classList.remove('show'); });

/* ============ Diagnóstico ============ */
const OUT = {
  ping:  ()=>'PING api.hoit.cl (152.204.11.8): 56 data bytes\n64 bytes: icmp_seq=0 ttl=54 time=182.4 ms\n64 bytes: icmp_seq=1 ttl=54 time=179.8 ms\n64 bytes: icmp_seq=2 ttl=54 time=185.1 ms\n--- 3 packets, 0% packet loss ---',
  dns:   ()=>'Resolviendo api.hoit.cl…\nServidor: 192.168.10.1\napi.hoit.cl → 152.204.11.8 (28 ms)',
  http:  ()=>'GET https://api.hoit.cl/health\nTLS 1.3 · certificado válido (expira 2026-11-02)\nHTTP/1.1 200 OK · 184 ms',
  at:    ()=>'AT → OK\nAT+CSQ → +CSQ: 21,99 (-71 dBm)\nAT+CREG? → +CREG: 0,1 (registrado)\nAT+COPS? → +COPS: 0,0,"Entel",7',
  gps:   ()=>'$GPGGA,094112,3326.9347,S,07040.1559,W,1,11,0.9,567.0,M…\nFix: 3D · Sats: 11 · HDOP: 0.9 → OK',
  sens:  ()=>'Consultando /dev/ttyS1 @ 9600 8N1 (Modbus RTU)…\nTX: 01 03 00 0A 00 02 E4 09\nRX: 01 03 04 00 2A 00 44 5A 3B · CRC OK\nVelocidad de viento: 4.2 m/s → OK',
  if:    ()=>'eth0   UP    192.168.10.20/24   1 Gbps\nwlan0  UP    10.42.0.1/24       AP (3 clientes)\nwwan0  UP    10.111.24.187/30   LTE standby',
  rt:    ()=>'default via 192.168.10.1 dev eth0  metric 100\ndefault via 10.111.24.186 dev wwan0  metric 600\n10.42.0.0/24 dev wlan0',
  ps:    ()=>'PID   SERVICIO           CPU   MEM\n412   telemetry-agent    1.2%  14 MB\n428   sensor-daemon      0.8%   9 MB\n455   gps-daemon         0.4%   7 MB\n461   watchdog           0.1%   3 MB'
};
function runDiag(kind){
  const out = $('#diagOut');
  out.textContent = (lang ? 'Running…' : 'Ejecutando…');
  setTimeout(()=>{ out.textContent = OUT[kind](); }, 450);
}
const runBtn = $('#runTool');
if(runBtn) runBtn.addEventListener('click', ()=>{
  const tool = $('#pingTool').value.toLowerCase();
  runDiag(tool==='ping'?'ping':tool==='dns'?'dns':'http');
});
$$('[data-run]').forEach(b=>b.addEventListener('click', ()=>runDiag(b.dataset.run)));

applyLang();


/* ============ Dashboard real del gateway ============ */
(function(){
  if(document.body.dataset.page !== 'dashboard') return;

  const byId = id => document.getElementById(id);
  const safe = (value, fallback='—') =>
    value === undefined || value === null || value === '' ? fallback : String(value);

  function setDot(id, state){
    const el = byId(id);
    if(!el) return;
    el.className = 'dot ' + (state === 'ok' ? 'ok' : state === 'warn' ? 'warn' : state === 'err' ? 'err' : 'off');
  }

  function setBadge(id, text, state){
    const el = byId(id);
    if(!el) return;
    el.textContent = text;
    el.className = 'badge ' + (state === 'ok' ? 'ok' : state === 'warn' ? 'warn' : state === 'err' ? 'err' : state === 'info' ? 'info' : 'off');
  }

  function formatDuration(seconds){
    seconds = Number(seconds || 0);
    if(!Number.isFinite(seconds) || seconds < 0) return '—';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if(days > 0) return `${days} d ${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`;
    return `${hours} h ${String(minutes).padStart(2,'0')} min`;
  }

  function formatAge(seconds){
    seconds = Number(seconds);
    if(!Number.isFinite(seconds) || seconds < 0) return '—';
    if(seconds < 60) return `hace ${Math.round(seconds)} s`;
    if(seconds < 3600) return `hace ${Math.round(seconds/60)} min`;
    if(seconds < 86400) return `hace ${Math.round(seconds/3600)} h`;
    return `hace ${Math.round(seconds/86400)} d`;
  }

  function serviceLabel(state){
    return state === 'running' ? 'En ejecución' : 'Detenido';
  }

  function render(data){
    const gateway = data.gateway || {};
    const connection = gateway.connection || {};
    const modem = gateway.modem || {};
    const gps = gateway.gps || {};
    const meteo = data.meteo || {};
    const interfaces = data.interfaces || {};
    const services = data.services || {};
    const system = data.system || {};

    const activeIf = safe(data.network && data.network.active_interface, safe(connection.wan_if, 'Sin ruta'));
    const internetOk = Number(connection.internet_ok || 0) === 1;
    const httpOk = Number(connection.http_ok || 0) === 1;
    const gpsFix = gps.fix === true || gps.fix === 1 || gps.fix === '1';
    const meteoRunning = services.hoit_meteo === 'running';
    const allServices = Object.values(services).every(v => v === 'running');
    const overallOk = internetOk && allServices;

    byId('dashHeroTitle').textContent = overallOk
      ? 'El gateway está operando correctamente'
      : 'El gateway requiere revisión';
    byId('dashHeroSubtitle').textContent = overallOk
      ? 'Los servicios principales están activos y existe una ruta de conectividad disponible.'
      : 'Uno o más servicios o enlaces no se encuentran disponibles.';
    byId('dashActiveRoute').textContent = activeIf;
    byId('dashLastCommunication').textContent = formatAge(data.ages && data.ages.gateway_status_sec);
    byId('dashUptime').textContent = formatDuration(system.uptime_sec);

    byId('dashConnectivityValue').textContent = internetOk ? activeIf : 'Sin Internet';
    byId('dashConnectivitySub').textContent =
      `Ethernet ${interfaces.ethernet && interfaces.ethernet.link ? 'con enlace' : 'sin enlace'} · WiFi ${safe(interfaces.wifi && interfaces.wifi.mode, '—')} · LTE ${connection.wan_ok == 1 ? 'activo' : 'sin enlace'}`;
    setDot('dashConnectivityDot', internetOk ? 'ok' : 'warn');

    byId('dashServerValue').textContent = httpOk ? 'HTTP disponible' : 'Sin respuesta';
    byId('dashServerSub').textContent = safe(gateway.reported_at, 'Sin último reporte');
    setDot('dashServerDot', httpOk ? 'ok' : 'warn');

    const wind = meteo.wind_speed_ms ?? meteo.wind_speed ?? meteo.speed_ms ?? meteo.speed;
    byId('dashSensorValue').textContent = wind !== undefined ? `${wind} m/s` : (meteoRunning ? 'Operativo' : 'Detenido');
    byId('dashSensorSub').textContent = meteoRunning
      ? `Anemómetro · ${formatAge(data.ages && data.ages.meteo_sec)}`
      : 'Servicio hoit_meteo detenido';
    setDot('dashSensorDot', meteoRunning ? 'ok' : 'err');

    byId('dashGpsValue').textContent = gpsFix ? 'Fix disponible' : 'Sin fix';
    byId('dashGpsSub').textContent = gpsFix
      ? `${safe(gps.latitude || gps.lat)}, ${safe(gps.longitude || gps.lon)} · ${safe(gps.altitude_m || gps.alt, '—')} m`
      : 'Sin posición GNSS válida';
    setDot('dashGpsDot', gpsFix ? 'ok' : 'warn');

    const eth = interfaces.ethernet || {};
    setBadge('dashEthBadge', eth.link ? 'Conectado' : 'Sin enlace', eth.link ? 'ok' : 'off');
    byId('dashEthIp').textContent = safe(eth.ip);
    byId('dashEthLink').textContent = eth.link ? safe(eth.operstate, 'up') : 'Cable desconectado';

    const wifi = interfaces.wifi || {};
    setBadge('dashWifiBadge', safe(wifi.mode, '—').toUpperCase(), wifi.up ? 'ok' : 'off');
    byId('dashWifiSsid').textContent = safe(wifi.ssid);
    byId('dashWifiClients').textContent = safe(wifi.clients, '0');

    const lteConnected = Number(connection.wan_ok || 0) === 1;
    setBadge('dashLteBadge', lteConnected ? 'Conectado' : 'Sin enlace', lteConnected ? 'ok' : 'warn');
    byId('dashLteOperator').textContent = safe(modem.operator);
    byId('dashLteRssi').textContent = modem.rssi !== undefined ? `CSQ ${modem.rssi}` : '—';

    setBadge('dashGpsBadge', gpsFix ? 'Fix' : 'Sin fix', gpsFix ? 'ok' : 'warn');
    const lat = gps.latitude ?? gps.lat;
    const lon = gps.longitude ?? gps.lon;
    byId('dashGpsPosition').textContent =
      lat !== undefined && lon !== undefined ? `${lat}, ${lon}` : '—';
    byId('dashGpsUpdated').textContent = formatAge(data.ages && data.ages.gps_sec);

    const serviceOrder = ['hoit_conn','hoit_meteo','hoit_portal','sshd'];
    byId('dashServices').innerHTML = serviceOrder.map(name => {
      const state = services[name] || 'stopped';
      return `<div class="list-row"><span class="dot ${state === 'running' ? 'ok' : 'err'}"></span>${name}<span class="when">${serviceLabel(state)}</span></div>`;
    }).join('');

    const events = [];
    events.push({
      state: httpOk ? 'ok' : 'warn',
      text: httpOk ? 'Servidor HOIT accesible' : 'Servidor HOIT sin respuesta',
      when: formatAge(data.ages && data.ages.gateway_status_sec)
    });
    events.push({
      state: lteConnected ? 'info' : 'warn',
      text: lteConnected
        ? `LTE activo · ${safe(modem.operator)} · ${safe(connection.ip_address)}`
        : 'LTE sin conexión de datos',
      when: 'Ahora'
    });
    events.push({
      state: gpsFix ? 'ok' : 'warn',
      text: gpsFix ? 'Posición GNSS disponible' : 'GPS sin fix',
      when: formatAge(data.ages && data.ages.gps_sec)
    });
    events.push({
      state: meteoRunning ? 'ok' : 'err',
      text: meteoRunning ? 'Servicio meteorológico activo' : 'Servicio meteorológico detenido',
      when: formatAge(data.ages && data.ages.meteo_sec)
    });

    byId('dashEvents').innerHTML = events.map(e =>
      `<div class="list-row"><span class="dot ${e.state}"></span><span>${e.text}</span><span class="when">${e.when}</span></div>`
    ).join('');
  }

  function renderError(error){
    byId('dashHeroTitle').textContent = 'No fue posible consultar el gateway';
    byId('dashHeroSubtitle').textContent = error && error.message ? error.message : 'Error de comunicación con dashboard.cgi';
    setDot('dashConnectivityDot','err');
    setDot('dashServerDot','err');
    setDot('dashSensorDot','err');
    setDot('dashGpsDot','err');
  }

  async function loadDashboard(){
    try{
      const response = await fetch('/cgi-bin/dashboard.cgi', {cache:'no-store'});
      if(!response.ok) throw new Error(`CGI respondió HTTP ${response.status}`);
      const data = await response.json();
      if(data.ok !== true) throw new Error(data.error || 'Respuesta inválida del gateway');
      render(data);
    }catch(error){
      renderError(error);
    }
  }

  loadDashboard();
  window.setInterval(loadDashboard, 30000);
})();

/* ============ Conectividad real del gateway ============ */
(function(){
  if(document.body.dataset.page !== 'connectivity') return;

  const byId = id => document.getElementById(id);
  const safe = (value, fallback='—') =>
    value === undefined || value === null || value === '' ? fallback : String(value);
  const esc = value => safe(value, '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  let lastData = null;
  let loading = false;

  function setText(id, value, fallback='—'){
    const el = byId(id); if(el) el.textContent = safe(value, fallback);
  }
  function setValue(id, value, fallback='—'){
    const el = byId(id); if(el) el.value = safe(value, fallback);
  }
  function setDot(id, state){
    const el = byId(id); if(!el) return;
    el.className = 'dot ' + (state === 'ok' ? 'ok' : state === 'warn' ? 'warn' : state === 'err' ? 'err' : state === 'info' ? 'info' : 'off');
  }
  function setBadge(id, text, state){
    const el = byId(id); if(!el) return;
    el.textContent = text;
    el.className = 'badge ' + (state === 'ok' ? 'ok' : state === 'warn' ? 'warn' : state === 'err' ? 'err' : state === 'info' ? 'info' : 'off');
  }
  function yesNo(value){ return value ? (lang ? 'Yes' : 'Sí') : (lang ? 'No' : 'No'); }
  function serviceLabel(value){ return value === 'running' ? (lang ? 'Running' : 'En ejecución') : (lang ? 'Stopped' : 'Detenido'); }
  function interfaceName(iface){
    return iface === 'eth0' ? 'Ethernet' : iface === 'wlan1' ? 'WiFi cliente' : iface === 'rmnet_data0' ? 'LTE' : safe(iface, 'Sin ruta');
  }
  function iconFor(iface){ return iface === 'eth0' ? '#i-eth' : iface === 'wlan1' ? '#i-wifi' : '#i-lte'; }
  function metricNumber(value){
    const n = Number(value);
    return Number.isFinite(n) ? n : 99999;
  }
  function formatTimestamp(value){
    if(!value) return '—';
    const d = new Date(value);
    if(Number.isNaN(d.getTime())) return value;
    return d.toLocaleString(lang ? 'en-US' : 'es-CL', {hour12:false});
  }
  function bytes(value){
    const n = Number(value);
    if(!Number.isFinite(n) || n < 0) return '—';
    if(n < 1024) return `${n} B`;
    if(n < 1048576) return `${(n/1024).toFixed(1)} KiB`;
    return `${(n/1048576).toFixed(1)} MiB`;
  }
  function signalLevel(dbm){
    const n = Number(dbm);
    if(!Number.isFinite(n)) return 0;
    if(n >= -50) return 5;
    if(n >= -60) return 4;
    if(n >= -70) return 3;
    if(n >= -80) return 2;
    return 1;
  }
  function signalMarkup(dbm){
    const level = signalLevel(dbm);
    const bars = [1,2,3,4,5].map(i => `<i class="${i<=level?'on':''}"></i>`).join('');
    return `<span class="conn-signal"><span class="conn-signal-bars">${bars}</span><span class="data">${esc(dbm ? `${dbm} dBm` : '—')}</span></span>`;
  }
  function csqText(csq){
    const n = Number(csq);
    if(!Number.isFinite(n) || n === 99) return 'CSQ no disponible';
    if(n >= 0 && n <= 31) return `CSQ ${n} · ${2*n-113} dBm`;
    return safe(csq);
  }
  function ratText(rat){
    const map = {'0':'GSM','2':'UTRAN/3G','3':'GSM/EDGE','4':'HSDPA','5':'HSUPA','6':'HSPA','7':'LTE','8':'EC-GSM-IoT','9':'NB-IoT'};
    return map[String(rat)] || (rat ? `RAT ${rat}` : '—');
  }
  function registrationOk(value){
    return /[, ](1|5)(?:\D|$)/.test(String(value || ''));
  }

  function renderPriority(data){
    const routes = Array.isArray(data.routes) ? data.routes.slice() : [];
    const activeIf = safe(data.active && data.active.interface, '');
    const known = {
      eth0: {interface:'eth0', gateway:safe(data.ethernet && data.ethernet.gateway,''), metric:safe(data.ethernet && data.ethernet.metric,''), available:Boolean(data.ethernet && data.ethernet.link)},
      wlan1: {interface:'wlan1', gateway:safe(data.wifi && data.wifi.client && data.wifi.client.gateway,''), metric:safe(data.wifi && data.wifi.client && data.wifi.client.metric,''), available:Boolean(data.wifi && data.wifi.client && data.wifi.client.connected)},
      rmnet_data0: {interface:'rmnet_data0', gateway:safe(data.lte && data.lte.gateway,''), metric:safe(data.lte && data.lte.metric,''), available:Boolean(data.lte && data.lte.ip)}
    };
    routes.forEach(r => { if(known[r.interface]) known[r.interface] = {...known[r.interface], ...r}; });
    const rows = Object.values(known).sort((a,b) => {
      const am = a.gateway !== '' ? metricNumber(a.metric) : 99999;
      const bm = b.gateway !== '' ? metricNumber(b.metric) : 99999;
      return am-bm;
    });

    byId('connPriorityList').innerHTML = rows.map((route,index) => {
      const active = route.interface === activeIf;
      const hasRoute = route.gateway !== '';
      let badge = '';
      if(active) badge = `<span class="badge ok">${lang?'In use':'En uso'}</span>`;
      else if(hasRoute && route.available) badge = `<span class="badge info">${lang?'Standby':'Respaldo'}</span>`;
      else if(hasRoute) badge = `<span class="badge warn">${lang?'Route present':'Ruta presente'}</span>`;
      else badge = `<span class="badge off">${lang?'No route':'Sin ruta'}</span>`;
      const detail = hasRoute ? `${esc(route.gateway)} · metric ${esc(route.metric || 0)}` : (route.available ? (lang?'No default route':'Sin ruta por defecto') : (lang?'Unavailable':'No disponible'));
      return `<div class="prio-row ${active?'active-route':''}">
        <span class="num">${index+1}</span>
        <svg width="18" height="18" style="stroke:var(--ink-2);fill:none;stroke-width:1.7"><use href="${iconFor(route.interface)}"/></svg>
        <b>${interfaceName(route.interface)}</b>${badge}
        <span class="conn-route-detail">${detail}</span>
      </div>`;
    }).join('');

    setText('connRouteSummary', `${lang?'Effective route':'Ruta efectiva'}: ${interfaceName(activeIf)} · ${safe(data.active && data.active.source_ip)} → ${safe(data.active && data.active.gateway)}`);
    setBadge('connFailoverBadge', routes.length > 1 ? (lang?'Automatic failover':'Failover automático') : (lang?'Single route':'Ruta única'), routes.length > 1 ? 'ok' : 'warn');
  }

  function renderEthernet(data){
    const eth = data.ethernet || {};
    const connected = Boolean(eth.link);
    setDot('connEthDot', connected ? 'ok' : 'off');
    setText('connEthState', connected ? (lang?'Connected':'Conectado') : (lang?'Cable disconnected':'Cable desconectado'));
    setText('connEthStateSub', connected ? safe(eth.operstate,'up') : 'eth0');
    setText('connEthSpeed', connected && Number(eth.speed_mbps) > 0 ? `${eth.speed_mbps} Mbps` : '—');
    setText('connEthDuplex', connected && eth.duplex ? `${eth.duplex} duplex` : (lang?'No active link':'Sin enlace activo'));
    setText('connEthMac', eth.mac);
    setValue('connEthIp', eth.ip);
    setValue('connEthPrefix', eth.prefix ? `/${eth.prefix}` : '—');
    setValue('connEthGateway', eth.gateway);
    setValue('connDns', data.dns);
  }

  function renderWifi(data){
    const wifi = data.wifi || {};
    const ap = wifi.ap || {};
    const client = wifi.client || {};
    const mode = safe(wifi.mode);
    const apOk = Boolean(ap.up && ap.exists);
    const clientOk = Boolean(client.connected);

    setBadge('connWifiModeBadge', mode, apOk || clientOk ? 'ok' : 'off');
    setDot('connApDot', apOk ? 'ok' : 'off');
    setBadge('connApBadge', apOk ? (lang?'Active':'Activo') : (lang?'Inactive':'Inactivo'), apOk ? 'ok' : 'off');
    setText('connApSsid', ap.ssid);
    setText('connApIp', ap.ip);
    setText('connApSecurity', ap.security);
    setText('connApChannel', ap.channel ? `${ap.channel}${ap.frequency_mhz ? ` · ${ap.frequency_mhz} MHz` : ''}` : '—');
    setText('connApClients', ap.clients, '0');

    setDot('connClientDot', clientOk ? 'ok' : client.exists ? 'warn' : 'off');
    setBadge('connClientBadge', clientOk ? (client.active ? (lang?'Connected · In use':'Conectado · En uso') : (lang?'Connected · Standby':'Conectado · Respaldo')) : safe(client.state, lang?'Disconnected':'Desconectado'), clientOk ? (client.active?'ok':'info') : 'off');
    setText('connClientSsid', client.ssid);
    setText('connClientIp', client.ip);
    setText('connClientGateway', client.gateway);
    const signal = client.signal_dbm ? `${client.signal_dbm} dBm` : '—';
    setText('connClientSignal', signal);
    setText('connClientRoute', client.active ? (lang?'Primary route':'Ruta principal') : client.connected ? (lang?'Standby':'Respaldo') : (lang?'No route':'Sin ruta'));
    setText('connClientBssid', client.bssid);
    setValue('connClientBssid', client.bssid);
    setValue('connClientFreq', client.frequency_mhz ? `${client.frequency_mhz} MHz` : '—');
    setValue('connClientBitrate', client.tx_bitrate);
    setValue('connClientMetric', client.metric);
    setBadge('connWpaState', safe(client.state,'—'), clientOk ? 'ok' : client.exists ? 'warn' : 'off');

    const clients = Array.isArray(wifi.clients) ? wifi.clients : [];
    setText('connClientsBadge', clients.length, '0');
    byId('connClientsBody').innerHTML = clients.length ? clients.map(c => {
      const device = c.hostname ? `${esc(c.hostname)}<small class="data">${esc(c.mac)}</small>` : `<span class="data">${esc(c.mac)}</span>`;
      return `<tr><td class="conn-device-cell">${device}</td><td class="data">${esc(c.ip || '—')}</td><td>${signalMarkup(c.signal_dbm)}</td></tr>`;
    }).join('') : `<tr><td colspan="3" class="conn-empty">${lang?'No clients connected':'Sin clientes conectados'}</td></tr>`;

    const serviceOrder = [['hoit_wifi','HOIT WiFi Manager'],['hostapd','hostapd · AP'],['dnsmasq','dnsmasq · DHCP'],['wpa_supplicant','wpa_supplicant · Cliente']];
    const services = wifi.services || {};
    byId('connWifiServices').innerHTML = serviceOrder.map(([key,label]) => {
      const state = services[key] || 'stopped';
      return `<div class="list-row"><span class="dot ${state==='running'?'ok':'err'}"></span>${label}<span class="when">${serviceLabel(state)}</span></div>`;
    }).join('');
  }

  function renderLte(data){
    const lte = data.lte || {};
    const gateway = data.gateway || {};
    const connection = gateway.connection || {};
    const modem = gateway.modem || {};
    const reg = gateway.registration || {};
    const connected = Boolean(lte.ip && lte.up);

    setDot('connLteDot', connected ? (lte.active?'ok':'info') : 'off');
    setText('connLteOperator', modem.operator || (connected ? (lang?'Registered':'Registrado') : (lang?'No service':'Sin servicio')));
    setText('connLteRegistration', connected ? `${lte.active ? (lang?'Active route':'Ruta activa') : (lang?'Backup route':'Ruta de respaldo')} · ${safe(lte.interface,'rmnet_data0')}` : (lang?'No data IP':'Sin IP de datos'));
    setText('connLteSignal', csqText(modem.rssi));
    setText('connLteRat', `${ratText(modem.rat)}${modem.ber ? ` · BER ${modem.ber}` : ''}`);
    setText('connLteIp', lte.ip || connection.ip_address);
    setText('connLteRoute', `${lte.active ? (lang?'In use':'En uso') : (lang?'Standby':'Respaldo')} · gateway ${safe(lte.gateway)} · metric ${safe(lte.metric)}`);
    const config = lte.configuration || {};
    setValue('connLteIccid', modem.iccid);
    setValue('connLteImei', modem.imei);
    setValue('connLteImsi', modem.imsi || modem.imsi_prefix);
    setValue('connLteApn', config.apn || connection.apn || 'Automático (operador)');
    setValue('connLteProfile', config.profile_id || connection.profile_id);
    setValue('connLteMetric', lte.metric);

    window.HOIT_LTE_CURRENT_CONFIG = config;
    window.dispatchEvent(new CustomEvent('hoit:lte-config', {detail:config}));

    [['connCgatt','connCgattDot',reg.cgatt],['connCereg','connCeregDot',reg.cereg],['connCreg','connCregDot',reg.creg]].forEach(([textId,dotId,value]) => {
      setText(textId,value);
      setDot(dotId, registrationOk(value) ? 'ok' : value ? 'warn' : 'off');
    });
  }

  function render(data){
    lastData = data;
    renderPriority(data);
    renderEthernet(data);
    renderWifi(data);
    renderLte(data);
    setText('connUpdated', `${lang?'Updated':'Actualizado'}: ${formatTimestamp(data.generated_at)}`);
    const global = document.querySelector('.health-pill');
    if(global){
      const active = safe(data.active && data.active.interface,'');
      const ok = Boolean(active);
      const dot = global.querySelector('.dot');
      const txt = global.querySelector('.txt');
      if(dot) dot.className = `dot ${ok?'ok':'warn'}`;
      if(txt) txt.textContent = ok ? (lang?'Operational':'Operativo') : (lang?'No active route':'Sin ruta activa');
    }
  }

  function renderError(error){
    setText('connUpdated', `${lang?'Error':'Error'}: ${error && error.message ? error.message : 'connectivity.cgi'}`);
    setBadge('connFailoverBadge', lang?'Query failed':'Error de consulta','err');
    ['connEthDot','connApDot','connClientDot','connLteDot'].forEach(id => setDot(id,'err'));
  }

  async function loadConnectivity(){
    if(loading) return;
    loading = true;
    const button = byId('connRefresh');
    if(button) button.classList.add('loading');
    try{
      const response = await fetch('/cgi-bin/connectivity.cgi', {cache:'no-store'});
      if(!response.ok) throw new Error(`CGI HTTP ${response.status}`);
      const data = await response.json();
      if(data.ok !== true) throw new Error(data.error || 'Respuesta inválida');
      render(data);
    }catch(error){
      renderError(error);
    }finally{
      loading = false;
      if(button) button.classList.remove('loading');
    }
  }

  const refresh = byId('connRefresh');
  if(refresh) refresh.addEventListener('click', loadConnectivity);
  ['langEs','langEn'].forEach(id => {
    const button = byId(id);
    if(button) button.addEventListener('click', () => { if(lastData) render(lastData); });
  });

  loadConnectivity();
  window.setInterval(loadConnectivity, 10000);
})();

/* ============ Autenticación local del portal ============ */
(function(){
  if(document.body.dataset.page === 'login') return;
  const shield=document.createElement('div');
  shield.className='auth-shield';
  shield.innerHTML='<div class="auth-shield-card"><span class="auth-spinner"></span><b>Validando sesión</b><small>HOIT Gateway Portal</small></div>';
  document.body.appendChild(shield);

  const authFetch=async()=>{
    const response=await fetch('/cgi-bin/auth_status.cgi',{cache:'no-store'});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const data=await response.json();
    if(!data.authenticated){
      const next=location.pathname+location.search;
      location.replace(`/login.html?next=${encodeURIComponent(next)}`);
      throw new Error('not_authenticated');
    }
    window.HOIT_AUTH=data;
    shield.remove();
    setupAccount(data);
    return data;
  };

  function setupAccount(auth){
    const chip=document.querySelector('.user-chip');
    if(!chip) return;
    chip.textContent=(auth.username||'AD').slice(0,2).toUpperCase();
    chip.setAttribute('role','button');
    chip.setAttribute('tabindex','0');
    chip.setAttribute('title','Cuenta de administrador');

    const overlay=document.createElement('div');
    overlay.className='overlay portal-account-overlay';
    overlay.id='portalAccountOverlay';
    overlay.innerHTML=`<div class="modal portal-account-modal" role="dialog" aria-modal="true">
      <div class="portal-account-head"><div class="user-chip">${(auth.username||'AD').slice(0,2).toUpperCase()}</div><div><h4>Administrador del gateway</h4><p>${auth.username||'admin'}</p></div></div>
      <form id="portalPasswordForm" autocomplete="off">
        <div class="field"><label>Contraseña actual</label><input id="portalCurrentPassword" type="password" autocomplete="current-password"></div>
        <div class="field"><label>Nueva contraseña</label><input id="portalNewPassword" type="password" minlength="10" maxlength="64" autocomplete="new-password"></div>
        <div class="field"><label>Confirmar contraseña</label><input id="portalConfirmPassword" type="password" minlength="10" maxlength="64" autocomplete="new-password"></div>
        <div class="wifi-form-error" id="portalAccountError"></div>
        <div class="m-actions portal-account-actions"><button type="button" class="btn danger" id="portalLogout">Cerrar sesión</button><span class="spacer"></span><button type="button" class="btn ghost" id="portalAccountCancel">Cancelar</button><button type="submit" class="btn primary">Cambiar contraseña</button></div>
      </form>
    </div>`;
    document.body.appendChild(overlay);
    const open=()=>overlay.classList.add('show');
    const close=()=>overlay.classList.remove('show');
    chip.addEventListener('click',open);
    chip.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
    overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
    overlay.querySelector('#portalAccountCancel').addEventListener('click',close);
    overlay.querySelector('#portalLogout').addEventListener('click',async()=>{
      try{await fetch('/cgi-bin/logout.cgi',{method:'POST',headers:{'X-HOIT-CSRF':auth.csrf},cache:'no-store'});}catch(_){}
      location.replace('/login.html');
    });
    overlay.querySelector('#portalPasswordForm').addEventListener('submit',async e=>{
      e.preventDefault();
      const error=overlay.querySelector('#portalAccountError');
      error.textContent=''; error.classList.remove('show');
      const current=overlay.querySelector('#portalCurrentPassword').value;
      const next=overlay.querySelector('#portalNewPassword').value;
      const confirm=overlay.querySelector('#portalConfirmPassword').value;
      if(next!==confirm){error.textContent='Las contraseñas no coinciden.';error.classList.add('show');return;}
      try{
        const response=await fetch('/cgi-bin/password_change.cgi',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','X-HOIT-CSRF':auth.csrf},body:new URLSearchParams({current_password:current,new_password:next,confirm_password:confirm}),cache:'no-store'});
        const data=await response.json();
        if(!response.ok||data.ok!==true) throw new Error(data.error||`HTTP ${response.status}`);
        close();
        overlay.querySelector('#portalPasswordForm').reset();
        if(typeof toast==='function') toast('m_done');
      }catch(err){error.textContent=err.message;error.classList.add('show');}
    });
  }

  window.HOIT_AUTH_READY=authFetch().catch(error=>{if(error.message!=='not_authenticated'){shield.innerHTML='<div class="auth-shield-card"><b>No fue posible validar la sesión</b><small>Revisa el servicio del portal.</small></div>';throw error;}});
})();

/* ============ Configuración segura de WiFi cliente ============ */
(function(){
  if(document.body.dataset.page !== 'connectivity') return;
  const $id=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  let currentJob='';
  let pollTimer=0;

  const stageProgress={queued:8,backup:18,applying:32,association:48,dhcp:65,internet_test:82,completed:100,rollback:62,rolled_back:100,rollback_failed:100,validation:100,safety:100};
  const stageLabel={queued:'En cola',backup:'Respaldando',applying:'Aplicando',association:'Autenticando',dhcp:'Obteniendo IP',internet_test:'Validando Internet',completed:'Completado',rollback:'Restaurando',rolled_back:'Restaurado',rollback_failed:'Revisión requerida',validation:'Validación',safety:'Protección'};

  function setError(message=''){
    const el=$id('wifiFormError'); if(!el)return;
    el.textContent=message; el.classList.toggle('show',Boolean(message));
  }
  function signalBars(dbm){
    const n=Number(dbm); let level=n>=-50?5:n>=-60?4:n>=-70?3:n>=-80?2:1;
    return `<span class="conn-signal-bars">${[1,2,3,4,5].map(i=>`<i class="${i<=level?'on':''}"></i>`).join('')}</span>`;
  }
  async function api(url,options={}){
    await window.HOIT_AUTH_READY;
    const response=await fetch(url,{cache:'no-store',...options});
    let data={}; try{data=await response.json();}catch(_){}
    if(!response.ok||data.ok!==true) throw new Error(data.error||`HTTP ${response.status}`);
    return data;
  }

  async function scan(){
    const button=$id('wifiScanBtn');
    button.disabled=true; button.classList.add('loading');
    $id('wifiNetworkList').innerHTML='<div class="conn-empty">Escaneando redes…</div>';
    setError();
    try{
      const data=await api('/cgi-bin/wifi_scan.cgi');
      const networks=Array.isArray(data.networks)?data.networks:[];
      $id('wifiNetworkList').innerHTML=networks.length?networks.map(network=>`
        <button type="button" class="wifi-network-row ${network.connected?'connected':''} ${network.supported?'':'unsupported'}" data-ssid="${esc(network.ssid)}" data-security="${esc(network.mode)}" ${network.supported?'':'disabled'}>
          <span class="wifi-network-icon">${signalBars(network.signal_dbm)}</span>
          <span class="wifi-network-copy"><b>${esc(network.ssid)}</b><small>${esc(network.security)} · ${esc(network.signal_dbm)} dBm · ${esc(network.frequency_mhz)} MHz</small></span>
          ${network.connected?'<span class="badge ok">Conectado</span>':network.supported?'<span class="badge off">Seleccionar</span>':'<span class="badge warn">No compatible</span>'}
        </button>`).join(''):'<div class="conn-empty">No se encontraron redes visibles.</div>';
    }catch(error){
      $id('wifiNetworkList').innerHTML=`<div class="conn-empty">${esc(error.message)}</div>`;
    }finally{
      button.disabled=false; button.classList.remove('loading');
    }
  }

  function selectNetwork(button){
    const ssid=button.dataset.ssid||'';
    const mode=button.dataset.security==='open'?'open':'psk';
    $id('wifiSsidInput').value=ssid;
    $id('wifiSecurityInput').value=mode;
    updateSecurity();
    document.querySelectorAll('.wifi-network-row').forEach(row=>row.classList.toggle('selected',row===button));
    if(mode==='psk') $id('wifiPasswordInput').focus();
  }

  function updateSecurity(){
    const open=$id('wifiSecurityInput').value==='open';
    $id('wifiPasswordField').hidden=open;
    $id('wifiPasswordInput').required=!open;
    if(open)$id('wifiPasswordInput').value='';
  }

  function renderJob(job){
    const panel=$id('wifiJobPanel'); panel.hidden=false;
    const success=job.done&&job.success;
    const failed=job.done&&!job.success;
    $id('wifiJobDot').className=`dot ${success?'ok':failed?'err':'info'}`;
    $id('wifiJobTitle').textContent=success?'Conexión WiFi guardada':failed?(job.restored?'Cambio rechazado y conexión restaurada':'El cambio requiere revisión'):'Probando conexión WiFi';
    $id('wifiJobMessage').textContent=job.message||'—';
    $id('wifiJobBadge').className=`badge ${success?'ok':failed?'err':'info'}`;
    $id('wifiJobBadge').textContent=stageLabel[job.stage]||job.stage||'En curso';
    $id('wifiJobProgress').style.width=`${stageProgress[job.stage]??20}%`;
    $id('wifiJobSsid').textContent=job.ssid||'—';
    $id('wifiJobIp').textContent=job.ip||'—';
    $id('wifiJobWpa').textContent=job.wpa_state||'—';
    if(job.done){
      clearTimeout(pollTimer);
      $id('wifiApplyBtn').disabled=!$id('wifiConfirmCheck').checked;
      if(job.success) setTimeout(()=>location.reload(),1800);
    }
  }

  async function pollJob(){
    if(!currentJob)return;
    try{
      const job=await api(`/cgi-bin/wifi_job.cgi?id=${encodeURIComponent(currentJob)}`);
      renderJob(job);
      if(!job.done)pollTimer=setTimeout(pollJob,3000);
    }catch(error){
      $id('wifiJobPanel').hidden=false;
      $id('wifiJobMessage').textContent='La interfaz cliente puede estar cambiando. Si esta página deja de responder, conéctate al AP HOIT y abre http://192.168.225.1.';
      pollTimer=setTimeout(pollJob,5000);
    }
  }

  async function apply(event){
    event.preventDefault();
    setError();
    const ssid=$id('wifiSsidInput').value.trim();
    const security=$id('wifiSecurityInput').value;
    const password=$id('wifiPasswordInput').value;
    if(!ssid){setError('Ingresa o selecciona un SSID.');return;}
    if(security==='psk'&&(password.length<8||password.length>64)){setError('La contraseña debe tener entre 8 y 63 caracteres, o 64 caracteres hexadecimales.');return;}
    if(!$id('wifiConfirmCheck').checked){setError('Confirma que comprendes el reinicio temporal de la conexión.');return;}
    const button=$id('wifiApplyBtn'); button.disabled=true; button.textContent='Iniciando prueba…';
    try{
      const auth=await window.HOIT_AUTH_READY;
      const data=await api('/cgi-bin/wifi_apply.cgi',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','X-HOIT-CSRF':auth.csrf},body:new URLSearchParams({ssid,security,password})});
      currentJob=data.job_id;
      renderJob({state:'queued',stage:'queued',message:'Solicitud recibida',ssid,ip:'',wpa_state:'',done:false,success:false});
      pollJob();
    }catch(error){
      setError(error.message);
      button.disabled=false;
    }finally{
      button.textContent='Probar y guardar conexión';
    }
  }

  function init(){
    $id('wifiScanBtn')?.addEventListener('click',scan);
    $id('wifiNetworkList')?.addEventListener('click',event=>{const row=event.target.closest('.wifi-network-row');if(row&&!row.disabled)selectNetwork(row);});
    $id('wifiSecurityInput')?.addEventListener('change',updateSecurity);
    $id('wifiConfirmCheck')?.addEventListener('change',event=>{$id('wifiApplyBtn').disabled=!event.target.checked;});
    $id('wifiPasswordToggle')?.addEventListener('click',()=>{const input=$id('wifiPasswordInput');const visible=input.type==='text';input.type=visible?'password':'text';$id('wifiPasswordToggle').textContent=visible?'Ver':'Ocultar';});
    $id('wifiApplyForm')?.addEventListener('submit',apply);
    updateSecurity();
  }
  window.HOIT_AUTH_READY.then(init).catch(()=>{});
})();


/* ============ Configuración segura de perfil LTE ============ */
(function(){
  if(document.body.dataset.page !== 'connectivity') return;
  const $id=id=>document.getElementById(id);
  let currentJob='';
  let pollTimer=0;
  let formDirty=false;
  let currentConfig={};

  const stageProgress={queued:8,backup:18,applying:35,registration:58,internet_test:82,completed:100,rollback:62,rolled_back:100,rollback_failed:100,validation:100,safety:100};
  const stageLabel={queued:'En cola',backup:'Respaldando',applying:'Aplicando módem',registration:'Registrando LTE',internet_test:'Validando Internet',completed:'Completado',rollback:'Restaurando',rolled_back:'Restaurado',rollback_failed:'Revisión requerida',validation:'Validación',safety:'Protección'};
  const authLabel={'0':'Ninguna','1':'PAP','2':'CHAP','3':'PAP o CHAP'};

  function setError(message=''){
    const el=$id('lteFormError'); if(!el)return;
    el.textContent=message; el.classList.toggle('show',Boolean(message));
  }

  async function api(url,options={}){
    await window.HOIT_AUTH_READY;
    const response=await fetch(url,{cache:'no-store',...options});
    let data={}; try{data=await response.json();}catch(_){}
    if(!response.ok||data.ok!==true) throw new Error(data.error||`HTTP ${response.status}`);
    return data;
  }

  function populate(config){
    currentConfig=config||{};
    if(formDirty)return;
    if($id('lteApnInput'))$id('lteApnInput').value=config.apn||'';
    if($id('lteProfileInput'))$id('lteProfileInput').value=config.profile_id||'6';
    if($id('ltePdpInput'))$id('ltePdpInput').value=['IP','IPV6','IPV4V6'].includes(config.pdp_type)?config.pdp_type:'IP';
    if($id('lteAuthInput'))$id('lteAuthInput').value=['0','1','2','3'].includes(String(config.auth_type))?String(config.auth_type):'0';
    if($id('lteUsernameInput'))$id('lteUsernameInput').value=config.username||'';
    if($id('ltePasswordInput'))$id('ltePasswordInput').value='';
    if($id('lteKeepPasswordCheck'))$id('lteKeepPasswordCheck').checked=Boolean(config.password_configured);
    updateAuthFields();
  }

  function updateAuthFields(){
    const auth=String($id('lteAuthInput')?.value||'0');
    const needsAuth=auth!=='0';
    if($id('lteUsernameField'))$id('lteUsernameField').hidden=!needsAuth;
    if($id('ltePasswordField'))$id('ltePasswordField').hidden=!needsAuth;
    if($id('lteKeepPasswordLine'))$id('lteKeepPasswordLine').hidden=!needsAuth;
    if($id('lteUsernameInput'))$id('lteUsernameInput').required=needsAuth;
    const configured=Boolean(currentConfig.password_configured);
    const state=$id('ltePasswordState');
    if(state)state.textContent=needsAuth?(configured?'Existe una contraseña guardada. Déjala en blanco para conservarla.':'No hay contraseña guardada; ingresa una nueva.'):'No se utiliza contraseña cuando la autenticación es «Ninguna».';
    if($id('lteKeepPasswordCheck')){
      $id('lteKeepPasswordCheck').disabled=!configured;
      if(!configured)$id('lteKeepPasswordCheck').checked=false;
    }
    if(!needsAuth&&$id('ltePasswordInput'))$id('ltePasswordInput').value='';
  }

  function renderJob(job){
    const panel=$id('lteJobPanel'); panel.hidden=false;
    const success=job.done&&job.success;
    const failed=job.done&&!job.success;
    $id('lteJobDot').className=`dot ${success?'ok':failed?'err':'info'}`;
    $id('lteJobTitle').textContent=success?'Perfil LTE guardado':failed?(job.restored?'Cambio rechazado y perfil restaurado':'El cambio LTE requiere revisión'):'Probando perfil LTE';
    $id('lteJobMessage').textContent=job.message||'—';
    $id('lteJobBadge').className=`badge ${success?'ok':failed?'err':'info'}`;
    $id('lteJobBadge').textContent=stageLabel[job.stage]||job.stage||'En curso';
    $id('lteJobProgress').style.width=`${stageProgress[job.stage]??20}%`;
    $id('lteJobApn').textContent=job.apn||'—';
    $id('lteJobProfile').textContent=job.profile_id||'—';
    $id('lteJobPdp').textContent=job.pdp_type||'—';
    $id('lteJobIp').textContent=job.ip||'—';
    if(job.done){
      clearTimeout(pollTimer);
      $id('lteApplyBtn').disabled=!$id('lteConfirmCheck').checked;
      if(job.success)setTimeout(()=>location.reload(),1800);
    }
  }

  async function pollJob(){
    if(!currentJob)return;
    try{
      const job=await api(`/cgi-bin/lte_job.cgi?id=${encodeURIComponent(currentJob)}`);
      renderJob(job);
      if(!job.done)pollTimer=setTimeout(pollJob,3000);
    }catch(error){
      $id('lteJobPanel').hidden=false;
      $id('lteJobMessage').textContent='LTE puede estar reiniciándose. El portal seguirá disponible por WiFi o por el AP HOIT.';
      pollTimer=setTimeout(pollJob,5000);
    }
  }

  async function apply(event){
    event.preventDefault();
    setError();
    const apn=$id('lteApnInput').value.trim();
    const profileId=$id('lteProfileInput').value.trim();
    const pdpType=$id('ltePdpInput').value;
    const authType=$id('lteAuthInput').value;
    const username=$id('lteUsernameInput').value;
    const password=$id('ltePasswordInput').value;
    const keepPassword=$id('lteKeepPasswordCheck').checked;
    const profile=Number(profileId);

    if(!/^[A-Za-z0-9._-]{0,100}$/.test(apn)){setError('El APN solo puede contener letras, números, punto, guion y guion bajo.');return;}
    if(!Number.isInteger(profile)||!((profile>=1&&profile<=24)||(profile>=100&&profile<=179))){setError('Profile ID inválido. Usa un valor entre 1-24 o 100-179.');return;}
    let passwordMode='clear';
    if(authType!=='0'){
      if(!username){setError(`La autenticación ${authLabel[authType]} requiere usuario APN.`);return;}
      if(password){passwordMode='replace';}
      else if(keepPassword&&currentConfig.password_configured){passwordMode='keep';}
      else {setError(`La autenticación ${authLabel[authType]} requiere contraseña APN.`);return;}
    }
    if(!$id('lteConfirmCheck').checked){setError('Confirma que comprendes el reinicio temporal de LTE.');return;}

    const button=$id('lteApplyBtn'); button.disabled=true; button.textContent='Iniciando prueba LTE…';
    try{
      const auth=await window.HOIT_AUTH_READY;
      const data=await api('/cgi-bin/lte_apply.cgi',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','X-HOIT-CSRF':auth.csrf},body:new URLSearchParams({apn,profile_id:profileId,pdp_type:pdpType,auth_type:authType,username,password,password_mode:passwordMode})});
      currentJob=data.job_id;
      renderJob({state:'queued',stage:'queued',message:'Solicitud LTE recibida',apn,profile_id:profileId,pdp_type:pdpType,auth_type:authType,ip:'',done:false,success:false,restored:false});
      pollJob();
    }catch(error){
      setError(error.message);
      button.disabled=false;
    }finally{
      button.textContent='Probar y guardar perfil LTE';
    }
  }

  function init(){
    const form=$id('lteApplyForm');
    if(!form)return;
    form.querySelectorAll('input,select').forEach(el=>el.addEventListener('input',()=>{formDirty=true;}));
    $id('lteAuthInput')?.addEventListener('change',()=>{formDirty=true;updateAuthFields();});
    $id('lteConfirmCheck')?.addEventListener('change',event=>{$id('lteApplyBtn').disabled=!event.target.checked;});
    $id('ltePasswordToggle')?.addEventListener('click',()=>{const input=$id('ltePasswordInput');const visible=input.type==='text';input.type=visible?'password':'text';$id('ltePasswordToggle').textContent=visible?'Ver':'Ocultar';});
    form.addEventListener('submit',apply);
    populate(window.HOIT_LTE_CURRENT_CONFIG||{});
  }

  window.addEventListener('hoit:lte-config',event=>populate(event.detail||{}));
  window.HOIT_AUTH_READY.then(init).catch(()=>{});
})();
