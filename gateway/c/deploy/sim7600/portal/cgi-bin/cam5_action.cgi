#!/bin/sh
# Acciones del gateway CAM-5 desde el portal local: reiniciar el servicio o probar una lectura Modbus.
# Requiere sesión, POST, token CSRF y rol operador o superior.
. /data/hoit/lib/portal_auth.sh || exit 1
[ "${REQUEST_METHOD:-GET}" = "POST" ] || pa_error 405 "Use POST"
pa_require_csrf
pa_read_form

BIN="/cache/cam5-gateway/cam5-gateway"
ACTION="$(pa_form_value action)"

case "$ACTION" in
  restart)
    pa_audit "service" "info" "cam5-gateway" "restart" "Reinicio del servicio cam5-gateway desde el portal" "" "" "${PA_USERNAME:-portal}" >/dev/null 2>&1 || true
    /etc/init.d/cam5-gateway restart >/dev/null 2>&1
    sleep 2
    if /etc/init.d/cam5-gateway status >/dev/null 2>&1; then STATE="running"; else STATE="stopped"; fi
    pa_json_headers; echo ""
    printf '{"ok":true,"service":"%s"}\n' "$STATE"
    ;;
  probe)
    TARGET="$(pa_form_value target)"
    UNIT="$(pa_form_value unit)"
    printf '%s' "$TARGET" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}(:[0-9]{1,5})?$' ||
      pa_error 400 "Dirección inválida: use IP o IP:puerto"
    case "$UNIT" in ''|*[!0-9]*) pa_error 400 "Unit ID inválido" ;; esac
    [ "$UNIT" -le 247 ] || pa_error 400 "Unit ID inválido"
    OUT="$(timeout 20 "$BIN" --probe "$TARGET" --unit "$UNIT" 2>&1)"
    RC=$?
    pa_json_headers; echo ""
    printf '{"ok":true,"exit_code":%s,"output":"%s"}\n' "$RC" "$(pa_json_escape "$OUT")"
    ;;
  *)
    pa_error 400 "Acción inválida"
    ;;
esac
