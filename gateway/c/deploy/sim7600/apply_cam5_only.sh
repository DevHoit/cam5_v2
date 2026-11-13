#!/bin/sh
# Deja un SIM7600 con la plataforma HOIT en modo "solo CAM-5":
#   - desactiva los servicios que no se usan (meteo, MQTT, Modbus duplicado, RTU, NMEA, digitales,
#     sockets, alarmas locales, trabajos remotos, auditoría); los binarios quedan en el equipo
#   - instala la nueva vigilancia de conectividad (hoit_conn), el cortafuegos y el gestor Wi-Fi corregido
#   - agrega la página CAM-5 → Core al portal y quita las páginas/CGI heredados e inseguros
#   - borra simuladores, prototipos, temporales y registros viejos
#
# Uso (en el equipo):  sh /cache/cam5-deploy/apply_cam5_only.sh /cache/cam5-deploy
# Respaldar antes: el script no guarda copia de lo que borra.

SRC="${1:-/cache/cam5-deploy}"
H=/data/hoit
say() { echo "[apply] $*"; }

for F in hoit_conn_watchdog.sh hoit_conn_runner.sh hoit_wifi_manager.sh hoit_timed portal/cam5.html portal/time-settings.html; do
    [ -f "$SRC/$F" ] || { echo "Falta $SRC/$F"; exit 1; }
done

DISABLE="hoit_meteo hoit_mqtt hoit_modbus hoit_modbus_rtu hoit_nmea hoit_digital hoit_socket hoit_alarm hoit_remote_jobs hoit_audit"
KEEP="hoit_dashboard hoit_portal hoit_wifi hoit_conn hoit_time"

mount -o remount,rw / || { echo "No se pudo montar / en escritura"; exit 1; }

# 1) Servicios -------------------------------------------------------------------------------
for S in $DISABLE; do
    [ -x "/etc/init.d/$S" ] && /etc/init.d/"$S" stop >/dev/null 2>&1
    update-rc.d -f "$S" remove >/dev/null 2>&1
done
sleep 2
for P in hoit_meteo hoit_mqttd hoit_mqtt_runner hoit_modbusd hoit_modbus_rtud hoit_nmead hoit_digitald \
         hoit_socket_manager hoit_tcp_forward hoit_alarmd hoit_remote_jobsd hoit_auditd \
         hoit_cam5_emulator hoit_flow_worker hoit_gps; do
    for PID in $(ps | grep "/data/hoit/bin/$P" | grep -v grep | awk '{print $1}'); do kill "$PID" 2>/dev/null; done
done
say "Servicios desactivados: $DISABLE"

# 2) Vigilancia de conectividad ---------------------------------------------------------------
/etc/init.d/hoit_conn stop >/dev/null 2>&1
for PID in $(ps | grep -E 'hoit_conn_(runner|watchdog)' | grep -v grep | awk '{print $1}'); do kill "$PID" 2>/dev/null; done
cp "$SRC/hoit_conn_watchdog.sh" "$H/bin/hoit_conn_watchdog.sh"
cp "$SRC/hoit_conn_runner.sh" "$H/bin/hoit_conn_runner.sh"
chmod 755 "$H/bin/hoit_conn_watchdog.sh" "$H/bin/hoit_conn_runner.sh"

C="$H/config/hoit_conn.conf"
TMP="$C.new"
# Se conservan APN, perfil y credenciales (los administra la página Conectividad del portal).
awk '!/^(DEVICE_ID|API_URL|API_KEY|HTTP_TEST_URL|CURL_INSECURE|STATUS_INTERVAL|GPS_INTERVAL|PING_HOST|LOG_FILE|WIFI_IF|PROBE_URL|CA_FILE)=/' "$C" > "$TMP"
cat >> "$TMP" <<'EOF'

# Vigilancia de conectividad (hoit_conn_watchdog.sh v2)
DEVICE_ID="CAM5-GW-01"
WIFI_IF="wlan1"
PROBE_URL="https://core.hoitlive.com/api/v1/gateway/heartbeat"
CA_FILE="/cache/cam5-gateway/ca-certificates.crt"
# PDP_RESET_AFTER=3  RADIO_RESET_AFTER=8  RADIO_RESET_EVERY=30  REBOOT_AFTER=45  REBOOT_MAX_PER_DAY=3
EOF
sh -n "$TMP" && mv -f "$TMP" "$C" && chmod 600 "$C"
say "hoit_conn: vigilancia v2 instalada"

# 3) hoit_health: vigilar solo lo que sigue activo ----------------------------------------------
HC="$H/config/hoit_health.conf"
sed -i \
  -e "s|^MONITORED_SERVICES=.*|MONITORED_SERVICES=\"$KEEP\"|" \
  -e "s|^AUTO_RESTART_SERVICES=.*|AUTO_RESTART_SERVICES=\"$KEEP\"|" \
  -e 's|^LOG_FILES=.*|LOG_FILES="/data/hoit/logs/hoit_dashboard.log /data/hoit/logs/hoit_time.log /data/hoit/logs/hoit_wifi.log /data/hoit/logs/hoit_wifi_service.log /data/hoit/logs/hoit_conn_runner.log /data/hoit/logs/lighttpd-hoit-error.log /data/hoit/logs/hoit_health_events.log /data/hoit/logs/hoit_health.log"|' \
  "$HC"

# 4) Portal --------------------------------------------------------------------------------------
W="$H/www"
cp "$SRC/portal/cam5.html" "$W/cam5.html"
cp "$SRC/portal/assets/cam5-v1.js" "$W/assets/cam5-v1.js"
cp "$SRC/portal/cgi-bin/cam5_status.cgi" "$SRC/portal/cgi-bin/cam5_action.cgi" "$W/cgi-bin/"
chmod 755 "$W/cgi-bin/cam5_status.cgi" "$W/cgi-bin/cam5_action.cgi"
# CGI heredados sin autenticación (reinicio, cambio de configuración, registros) y su JS.
rm -f "$W/cgi-bin/action.cgi" "$W/cgi-bin/config-get.cgi" "$W/cgi-bin/config-save.cgi" \
      "$W/cgi-bin/logs.cgi" "$W/cgi-bin/status.cgi"
rm -rf "$W/assets/js"
rm -f "$W/dashboard-legacy.html" "$W/assets/devices-v8.js" "$W/assets/diagnostic.js" \
      "$W/assets/mqtt-v3.js" "$W/assets/mqtt-v3.css" "$W/assets/login-v10.css"

N="$H/config/navigation.conf"
for ITEM in telemetry mqtt devices gps modbus_tcp tcp_bridges modbus_rtu digital_inputs nmea_serial \
            alarms audit_monitor remote_operations fleet_provisioning; do
    sed -i "s/^\(ITEM|[a-z]*|$ITEM|.*\)|1$/\1|0/" "$N"
done
grep -q '|cam5|' "$N" || echo 'ITEM|operation|cam5|CAM-5 → Core|cam5.html|telemetry|5|1' >> "$N"
# Hora: página con zona horaria (horario de verano de Chile) y reloj que no retrocede.
cp "$SRC/portal/time-settings.html" "$W/time-settings.html"
cp "$SRC/portal/assets/time-settings-v1.js" "$W/assets/time-settings-v1.js"
cp "$SRC/portal/cgi-bin/time_settings.cgi" "$SRC/portal/cgi-bin/time_settings_action.cgi" "$W/cgi-bin/"
chmod 755 "$W/cgi-bin/time_settings.cgi" "$W/cgi-bin/time_settings_action.cgi"
say "Portal: página CAM-5 agregada; menú y CGI heredados depurados"

# 5) Limpieza -------------------------------------------------------------------------------------
rm -rf /cache/hoit-cam5 /cache/hoit-v2 /cache/helloworld_bak
rm -rf /cache/hoit/mqtt_outbox
rm -f /cache/hoit/*.tmp.* /cache/hoit/*.fragment.tmp.* /cache/hoit/onboarding_physical_devices.* \
      /cache/hoit/hoit_meteo.log.* /cache/hoit/devices/*.tmp.* 2>/dev/null
rm -f "$H"/bin/*.pre_* "$H"/bin/patch_*.sh "$H"/bin/hoit_cam5_emulator.sh "$H"/bin/hoit_cam5_emulator_loop.sh
rm -f "$H"/config/*.pre_cam5 "$H"/config/*.tmp.*
rm -rf "$H"/backups/* "$H"/portal-installer "$H"/examples
rm -f "$H"/logs/*.1 "$H"/logs/*.2 "$H"/logs/*.3
for L in hoit_mqtt.log hoit_mqtt_commands.log hoit_health.log hoit_health_events.log hoit_wifi.log \
         hoit_wifi_service.log hoit_conn_watchdog.log hoit_conn_runner.log hoit_modbus.log; do
    [ -f "$H/logs/$L" ] && : > "$H/logs/$L"
done
say "Limpieza terminada"

sync
mount -o remount,ro / 2>/dev/null

# 6) Arranque ---------------------------------------------------------------------------------------
# setsid: lo que se lanza desde una sesión "adb shell" muere al cerrarla si no se separa.
cp "$SRC/hoit_wifi_manager.sh" "$H/bin/hoit_wifi_manager.sh" && chmod 755 "$H/bin/hoit_wifi_manager.sh"
/etc/init.d/hoit_wifi stop >/dev/null 2>&1
setsid /etc/init.d/hoit_wifi start </dev/null >/dev/null 2>&1
cp "$SRC/hoit_timed" "$H/bin/hoit_timed" && chmod 755 "$H/bin/hoit_timed"
TC="$H/config/hoit_time.conf"
sed -i -e '/^TIMEZONE=/d' -e 's|^MODE=.*|MODE=auto\nTIMEZONE=America/Santiago|' \
       -e 's|^CELLULAR_FALLBACK=.*|CELLULAR_FALLBACK=1|' "$TC"
/etc/init.d/hoit_time stop >/dev/null 2>&1
setsid /etc/init.d/hoit_time start </dev/null >/dev/null 2>&1
/etc/init.d/hoit_health stop >/dev/null 2>&1
setsid /etc/init.d/hoit_health start </dev/null >/dev/null 2>&1
setsid /etc/init.d/hoit_conn start </dev/null >/dev/null 2>&1
say "Listo. Espacio:"
df -h /data /cache | sed 's/^/        /'
