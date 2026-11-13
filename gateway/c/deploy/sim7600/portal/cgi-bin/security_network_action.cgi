#!/bin/sh
# Cambia el acceso de administración (portal y SSH) desde el Wi-Fi corporativo.
#   mode=allow   permitido sin vencimiento
#   mode=temp    permitido por hours (1–72) y luego bloqueado
#   mode=block   bloqueado: por esa red el gateway solo sale a internet
#   allow=       IP autorizadas (opcional), separadas por espacio o coma

. /data/hoit/lib/portal_auth.sh || exit 1

pa_require_post
pa_require_csrf
pa_require_role admin
pa_read_form

FW=/data/hoit/bin/hoit_firewall.sh
[ -x "$FW" ] || pa_error 503 "El cortafuegos no está instalado"

MODE="$(pa_form_value mode)"
HOURS="$(pa_form_value hours)"
ALLOW="$(pa_form_value allow | tr ',' ' ')"

CLEAN=""
COUNT=0
for IP in $ALLOW; do
    echo "$IP" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}(/([0-9]|[12][0-9]|3[0-2]))?$' ||
        pa_error 400 "IP no válida: $IP (usa direcciones IPv4, por ejemplo 192.168.1.20)"
    for OCTET in $(echo "${IP%%/*}" | tr '.' ' '); do
        [ "$OCTET" -le 255 ] || pa_error 400 "IP no válida: $IP"
    done
    COUNT=$((COUNT + 1))
    [ "$COUNT" -le 8 ] || pa_error 400 "Máximo 8 direcciones autorizadas"
    CLEAN="$CLEAN $IP"
done
CLEAN="${CLEAN# }"

NOW="$(date +%s)"
case "$MODE" in
    allow) ENABLED=1; UNTIL=0; TEXT="permitida" ;;
    temp)
        case "$HOURS" in ''|*[!0-9]*) pa_error 400 "Duración no válida" ;; esac
        [ "$HOURS" -ge 1 ] && [ "$HOURS" -le 72 ] || pa_error 400 "La duración debe estar entre 1 y 72 horas"
        [ "$NOW" -gt 1704067200 ] || pa_error 409 "El reloj del gateway no está sincronizado; usa Permitido o Bloqueado"
        ENABLED=1; UNTIL=$((NOW + HOURS * 3600)); TEXT="permitida por $HOURS h" ;;
    block) ENABLED=0; UNTIL=0; TEXT="bloqueada" ;;
    *) pa_error 400 "Modo no válido" ;;
esac

OLD="$("$FW" status-json 2>/dev/null)"
"$FW" set "$ENABLED" "$UNTIL" "$CLEAN" >/dev/null 2>&1 || pa_error 500 "No fue posible aplicar el cortafuegos"

pa_audit security warning firewall wifi_admin \
  "Administración desde el Wi-Fi corporativo $TEXT${CLEAN:+ (solo $CLEAN)}" "$OLD" "$ENABLED $UNTIL $CLEAN" "$PA_USERNAME"

pa_json_headers
echo ""
printf '{"ok":true,"message":"%s"}\n' "$(pa_json_escape "Administración desde el Wi-Fi corporativo $TEXT")"
