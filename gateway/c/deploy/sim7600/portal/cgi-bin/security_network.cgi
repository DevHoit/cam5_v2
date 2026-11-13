#!/bin/sh
# Estado del acceso de administración desde el Wi-Fi corporativo (Seguridad y acceso).

. /data/hoit/lib/portal_auth.sh || exit 1

pa_require_role admin

FW=/data/hoit/bin/hoit_firewall.sh
[ -x "$FW" ] || pa_error 503 "El cortafuegos no está instalado"

STATUS="$("$FW" status-json 2>/dev/null)"
[ -n "$STATUS" ] || pa_error 500 "No fue posible leer el cortafuegos"

# Interfaz por la que llega esta sesión: avisa antes de cortar el propio acceso.
CLIENT_IP="${REMOTE_ADDR:-}"
CLIENT_IF=""
case "$CLIENT_IP" in
    *[!0-9.]*|'') ;;
    *) CLIENT_IF="$(ip route get "$CLIENT_IP" 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')" ;;
esac

pa_json_headers
echo ""
printf '{"ok":true,"client_ip":"%s","client_interface":"%s","firewall":%s}\n' \
  "$(pa_json_escape "$CLIENT_IP")" "$(pa_json_escape "$CLIENT_IF")" "$STATUS"
