#!/bin/sh

. /data/hoit/lib/portal_auth.sh || exit 1
pa_require_post
pa_require_csrf
pa_read_form

APN="$(pa_form_value apn)"
PROFILE_ID="$(pa_form_value profile_id)"
PDP_TYPE="$(pa_form_value pdp_type)"
AUTH_TYPE="$(pa_form_value auth_type)"
USERNAME="$(pa_form_value username)"
PASSWORD="$(pa_form_value password)"
PASSWORD_MODE="$(pa_form_value password_mode)"

APN_LEN="$(printf '%s' "$APN" | wc -c | awk '{print $1}')"
# APN vacío = el operador asigna el suyo (SIM sin APN ni contraseña).
[ "$APN_LEN" -le 100 ] || pa_error 400 "El APN no puede superar 100 caracteres"
[ -z "$APN" ] || printf '%s' "$APN" | grep -Eq '^[A-Za-z0-9._-]+$' || pa_error 400 "El APN solo puede contener letras, números, punto, guion y guion bajo"

case "$PROFILE_ID" in ''|*[!0-9]*) pa_error 400 "Profile ID inválido" ;; esac
if ! { [ "$PROFILE_ID" -ge 1 ] && [ "$PROFILE_ID" -le 24 ]; } && ! { [ "$PROFILE_ID" -ge 100 ] && [ "$PROFILE_ID" -le 179 ]; }; then
    pa_error 400 "Profile ID fuera de rango: usa 1-24 o 100-179"
fi

case "$PDP_TYPE" in IP|IPV6|IPV4V6) ;; *) pa_error 400 "Tipo PDP no compatible" ;; esac
case "$AUTH_TYPE" in 0|1|2|3) ;; *) pa_error 400 "Método de autenticación inválido" ;; esac
case "$PASSWORD_MODE" in keep|replace|clear) ;; *) pa_error 400 "Modo de contraseña inválido" ;; esac

USER_LEN="$(printf '%s' "$USERNAME" | wc -c | awk '{print $1}')"
[ "$USER_LEN" -le 127 ] || pa_error 400 "El usuario APN supera 127 caracteres"
printf '%s' "$USERNAME" | LC_ALL=C grep -q '[[:cntrl:]"\\]' && pa_error 400 "El usuario APN contiene caracteres no permitidos"

if [ "$AUTH_TYPE" = "0" ]; then
    USERNAME=""
    PASSWORD=""
    PASSWORD_MODE="clear"
else
    [ -n "$USERNAME" ] || pa_error 400 "La autenticación seleccionada requiere usuario APN"
    case "$PASSWORD_MODE" in
        keep) : ;;
        replace)
            PASS_LEN="$(printf '%s' "$PASSWORD" | wc -c | awk '{print $1}')"
            [ "$PASS_LEN" -ge 1 ] && [ "$PASS_LEN" -le 127 ] || pa_error 400 "La contraseña APN debe tener entre 1 y 127 caracteres"
            printf '%s' "$PASSWORD" | LC_ALL=C grep -q '[[:cntrl:]"\\]' && pa_error 400 "La contraseña APN contiene caracteres no permitidos"
            ;;
        clear) pa_error 400 "La autenticación seleccionada requiere contraseña APN" ;;
    esac
fi

[ -x /etc/init.d/hoit_conn ] || pa_error 503 "El servicio hoit_conn no está instalado"
[ -x /data/hoit/bin/hoit_lte_apply_worker.sh ] || pa_error 503 "El worker LTE no está instalado"
[ -c /dev/smd8 ] || pa_error 503 "El puerto AT del módem no está disponible"

STATE="/data/hoit/state"
LOCK="$STATE/lte_apply.lock"
WIFI_LOCK="$STATE/wifi_apply.lock"
JOBS="$STATE/lte_jobs"
CACHE="/cache/hoit/lte_jobs"
mkdir -p "$STATE" "$JOBS" "$CACHE"
chmod 700 "$JOBS" 2>/dev/null

if [ -d "$WIFI_LOCK" ]; then
    WIFI_PID="$(cat "$WIFI_LOCK/pid" 2>/dev/null)"
    if [ -n "$WIFI_PID" ] && kill -0 "$WIFI_PID" 2>/dev/null; then
        pa_error 409 "Espera a que termine el cambio WiFi antes de modificar LTE"
    fi
fi

if ! mkdir "$LOCK" 2>/dev/null; then
    OLD_PID="$(cat "$LOCK/pid" 2>/dev/null)"
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        pa_error 409 "Ya existe un cambio LTE en curso"
    fi
    rm -rf "$LOCK"
    mkdir "$LOCK" 2>/dev/null || pa_error 409 "No fue posible obtener el bloqueo LTE"
fi

JOB_ID="$(pa_now)_$(pa_random_hex 8)"
JOB_DIR="$JOBS/$JOB_ID"
mkdir -p "$JOB_DIR"
chmod 700 "$JOB_DIR"
umask 077
printf '%s' "$APN" > "$JOB_DIR/apn"
printf '%s' "$PROFILE_ID" > "$JOB_DIR/profile_id"
printf '%s' "$PDP_TYPE" > "$JOB_DIR/pdp_type"
printf '%s' "$AUTH_TYPE" > "$JOB_DIR/auth_type"
printf '%s' "$USERNAME" > "$JOB_DIR/username"
printf '%s' "$PASSWORD_MODE" > "$JOB_DIR/password_mode"
printf '%s' "$PASSWORD" > "$JOB_DIR/password"
printf '%s' "${REMOTE_ADDR:-local}" > "$JOB_DIR/request_ip"

cat > "$CACHE/$JOB_ID.json" <<JSON
{"ok":true,"job_id":"$JOB_ID","state":"queued","stage":"queued","message":"Solicitud LTE recibida","apn":"$(pa_json_escape "$APN")","profile_id":"$(pa_json_escape "$PROFILE_ID")","pdp_type":"$(pa_json_escape "$PDP_TYPE")","auth_type":"$(pa_json_escape "$AUTH_TYPE")","ip":"","gateway":"","done":false,"success":false,"restored":false}
JSON
chmod 644 "$CACHE/$JOB_ID.json"

nohup /data/hoit/bin/hoit_lte_apply_worker.sh "$JOB_ID" </dev/null >> /data/hoit/logs/hoit_lte_apply.log 2>&1 &
WORKER_PID=$!
printf '%s\n' "$WORKER_PID" > "$LOCK/pid"
printf '%s\n' "$JOB_ID" > "$LOCK/job_id"
sleep 1
if ! kill -0 "$WORKER_PID" 2>/dev/null; then
    rm -rf "$LOCK" "$JOB_DIR"
    pa_error 500 "No fue posible iniciar el cambio LTE"
fi

echo "Status: 202 Accepted"
pa_json_headers
echo ""
printf '{"ok":true,"job_id":"%s","state":"queued","message":"Cambio LTE iniciado"}\n' "$JOB_ID"
