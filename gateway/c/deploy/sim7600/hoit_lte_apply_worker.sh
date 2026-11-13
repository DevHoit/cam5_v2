#!/bin/sh

JOB_ID="$1"
STATE="/data/hoit/state"
JOBS="$STATE/lte_jobs"
JOB_DIR="$JOBS/$JOB_ID"
CACHE="/cache/hoit/lte_jobs"
STATUS="$CACHE/$JOB_ID.json"
LOCK="$STATE/lte_apply.lock"
CONF="/data/hoit/config/hoit_conn.conf"
AT_PORT_DEFAULT="/dev/smd8"
WAN_IF_DEFAULT="rmnet_data0"
LOG="/data/hoit/logs/hoit_lte_apply.log"
CHECK_HOST="8.8.8.8"
CHECK_URL="https://hoitlive.com/"

case "$JOB_ID" in ''|*[!0-9a-fA-F_]*) exit 2 ;; esac
[ -d "$JOB_DIR" ] || exit 3
[ -r "$CONF" ] || exit 4
mkdir -p "$CACHE" /data/hoit/backups /data/hoit/logs "$STATE"
umask 077

json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\r//g; :a;N;$!ba;s/\n/\\n/g'
}

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null) job=$JOB_ID $*" >> "$LOG"
}

shell_quote() {
    printf "'"
    printf '%s' "$1" | sed "s/'/'\\\\''/g"
    printf "'"
}

load_active_config() {
    unset APN PROFILE_ID PDP_TYPE APN_AUTH APN_USER APN_PASSWORD AT_PORT WAN_IF
    # Archivo root-owned mode 600. Se carga para conservar el resto de variables HOIT.
    . "$CONF"
    # Sin ":": un APN vacío guardado a propósito no se reemplaza por el de fábrica.
    CFG_APN="${APN-gigsky-02}"
    CFG_PROFILE_ID="${PROFILE_ID:-6}"
    CFG_PDP_TYPE="${PDP_TYPE:-IP}"
    CFG_AUTH="${APN_AUTH:-0}"
    CFG_USER="${APN_USER:-}"
    CFG_PASSWORD="${APN_PASSWORD:-}"
    CFG_AT_PORT="${AT_PORT:-$AT_PORT_DEFAULT}"
    CFG_WAN_IF="${WAN_IF:-$WAN_IF_DEFAULT}"
}

write_config() {
    W_APN="$1"
    W_PROFILE="$2"
    W_PDP="$3"
    W_AUTH="$4"
    W_USER="$5"
    W_PASSWORD="$6"
    TMP="${CONF}.pending.$$"

    awk '!/^(APN|PROFILE_ID|PDP_TYPE|APN_AUTH|APN_USER|APN_PASSWORD)=/' "$CONF" > "$TMP" || return 1
    {
        printf '\n# Perfil LTE administrado por HOIT Portal v4\n'
        printf 'APN='; shell_quote "$W_APN"; printf '\n'
        printf 'PROFILE_ID='; shell_quote "$W_PROFILE"; printf '\n'
        printf 'PDP_TYPE='; shell_quote "$W_PDP"; printf '\n'
        printf 'APN_AUTH='; shell_quote "$W_AUTH"; printf '\n'
        printf 'APN_USER='; shell_quote "$W_USER"; printf '\n'
        printf 'APN_PASSWORD='; shell_quote "$W_PASSWORD"; printf '\n'
    } >> "$TMP"
    chmod 600 "$TMP"
    sh -n "$TMP" || { rm -f "$TMP"; return 1; }
    mv "$TMP" "$CONF"
}

lte_ipv4() {
    ip -4 addr show dev "$WAN_IF" 2>/dev/null | awk '/inet /{print $2;exit}' | cut -d/ -f1
}

lte_ipv6() {
    ip -6 addr show dev "$WAN_IF" scope global 2>/dev/null | awk '/inet6 /{print $2;exit}' | cut -d/ -f1
}

lte_ip_for_status() {
    V4="$(lte_ipv4)"
    [ -n "$V4" ] && { printf '%s' "$V4"; return; }
    lte_ipv6
}

lte_gateway() {
    ip route show default 2>/dev/null | awk -v iface="$WAN_IF" '$0 ~ (" dev " iface "( |$)") {for(i=1;i<=NF;i++) if($i=="via") {print $(i+1); exit}}'
}

internet_ok_v4() {
    IP4="$(lte_ipv4)"
    [ -n "$IP4" ] || return 1
    ping -I "$WAN_IF" -c 1 -W 5 "$CHECK_HOST" >/dev/null 2>&1 && return 0
    curl --interface "$WAN_IF" -4 -k -s --connect-timeout 7 --max-time 15 -o /dev/null "$CHECK_URL" >/dev/null 2>&1 && return 0
    return 1
}

internet_ok_v6() {
    IP6="$(lte_ipv6)"
    [ -n "$IP6" ] || return 1
    if command -v ping6 >/dev/null 2>&1; then
        ping6 -I "$WAN_IF" -c 1 -W 5 2001:4860:4860::8888 >/dev/null 2>&1 && return 0
    fi
    curl --interface "$WAN_IF" -6 -k -s --connect-timeout 7 --max-time 15 -o /dev/null "$CHECK_URL" >/dev/null 2>&1 && return 0
    return 1
}

internet_ok() {
    case "$TARGET_PDP" in
        IP) internet_ok_v4 ;;
        IPV6) internet_ok_v6 ;;
        IPV4V6) internet_ok_v4 || internet_ok_v6 ;;
        *) return 1 ;;
    esac
}

write_status() {
    STATE_VALUE="$1"
    STAGE_VALUE="$2"
    MESSAGE_VALUE="$3"
    DONE_VALUE="$4"
    SUCCESS_VALUE="$5"
    RESTORED_VALUE="${6:-false}"
    IP_NOW="$(lte_ip_for_status)"
    GW_NOW="$(lte_gateway)"
    TMP="$STATUS.tmp.$$"
    cat > "$TMP" <<JSON
{"ok":true,"job_id":"$JOB_ID","state":"$(json_escape "$STATE_VALUE")","stage":"$(json_escape "$STAGE_VALUE")","message":"$(json_escape "$MESSAGE_VALUE")","apn":"$(json_escape "$TARGET_APN")","profile_id":"$(json_escape "$TARGET_PROFILE")","pdp_type":"$(json_escape "$TARGET_PDP")","auth_type":"$(json_escape "$TARGET_AUTH")","ip":"$(json_escape "$IP_NOW")","gateway":"$(json_escape "$GW_NOW")","done":$DONE_VALUE,"success":$SUCCESS_VALUE,"restored":$RESTORED_VALUE,"updated_epoch":$(date +%s 2>/dev/null || echo 0)}
JSON
    chmod 644 "$TMP"
    mv "$TMP" "$STATUS"
}

at_cmd() {
    CMD="$1"
    OUT="/tmp/hoit_lte_at_${JOB_ID}_$$.out"
    rm -f "$OUT"
    cat "$AT_PORT" > "$OUT" 2>/dev/null &
    CAT_PID=$!
    sleep 0.3
    printf '%s\r' "$CMD" > "$AT_PORT" 2>/dev/null
    sleep 2
    kill "$CAT_PID" 2>/dev/null
    wait "$CAT_PID" 2>/dev/null
    tr -d '\r' < "$OUT" 2>/dev/null
    rm -f "$OUT"
}

at_is_ok() {
    printf '%s\n' "$1" | grep -q '^OK$'
}

apply_modem_profile() {
    P_APN="$1"
    P_PROFILE="$2"
    P_PDP="$3"
    P_AUTH="$4"
    P_USER="$5"
    P_PASSWORD="$6"

    RAW="$(at_cmd 'AT')"
    at_is_ok "$RAW" || { log "AT port no responde"; return 1; }

    at_cmd 'AT+CGATT=0' >/dev/null 2>&1
    sleep 2
    at_cmd "AT+CGACT=0,$P_PROFILE" >/dev/null 2>&1

    RAW="$(at_cmd "AT+CGDCONT=$P_PROFILE,\"$P_PDP\",\"$P_APN\"")"
    if ! at_is_ok "$RAW"; then
        log "CGDCONT rechazado profile=$P_PROFILE pdp=$P_PDP"
        return 1
    fi

    case "$P_AUTH" in
        0) RAW="$(at_cmd "AT+CGAUTH=$P_PROFILE,0")" ;;
        1|2|3) RAW="$(at_cmd "AT+CGAUTH=$P_PROFILE,$P_AUTH,\"$P_PASSWORD\",\"$P_USER\"")" ;;
        *) return 1 ;;
    esac
    if ! at_is_ok "$RAW"; then
        log "CGAUTH rechazado profile=$P_PROFILE auth=$P_AUTH"
        return 1
    fi

    # El attach puede tardar; el servicio hoit_conn continuará la recuperación.
    at_cmd 'AT+CGATT=1' >/dev/null 2>&1
    return 0
}

stop_conn() {
    /etc/init.d/hoit_conn stop >> "$LOG" 2>&1 || true
    sleep 3
}

start_conn() {
    /etc/init.d/hoit_conn start >> "$LOG" 2>&1 || return 1
    return 0
}

clear_lte_interface() {
    ip addr flush dev "$WAN_IF" 2>/dev/null || true
    while ip route show default 2>/dev/null | grep -q " dev $WAN_IF"; do
        ip route del default dev "$WAN_IF" 2>/dev/null || break
    done
    ifconfig "$WAN_IF" up >/dev/null 2>&1 || true
}

wait_for_lte() {
    COUNT=0
    while [ "$COUNT" -lt 24 ]; do
        sleep 5
        IP_NOW="$(lte_ip_for_status)"
        if [ -n "$IP_NOW" ]; then
            write_status running internet_test "IP LTE obtenida; validando acceso a Internet" false false false
            if internet_ok; then
                return 0
            fi
        else
            write_status running registration "Esperando registro, contexto de datos e IP LTE" false false false
        fi
        COUNT=$((COUNT + 1))
    done
    return 1
}

cleanup() {
    rm -f "$JOB_DIR/password"
    rm -rf "$LOCK"
}
trap cleanup 0 1 2 15

TARGET_APN="$(cat "$JOB_DIR/apn" 2>/dev/null)"
TARGET_PROFILE="$(cat "$JOB_DIR/profile_id" 2>/dev/null)"
TARGET_PDP="$(cat "$JOB_DIR/pdp_type" 2>/dev/null)"
TARGET_AUTH="$(cat "$JOB_DIR/auth_type" 2>/dev/null)"
TARGET_USER="$(cat "$JOB_DIR/username" 2>/dev/null)"
PASSWORD_MODE="$(cat "$JOB_DIR/password_mode" 2>/dev/null)"
SUBMITTED_PASSWORD="$(cat "$JOB_DIR/password" 2>/dev/null)"

load_active_config
OLD_APN="$CFG_APN"
OLD_PROFILE="$CFG_PROFILE_ID"
OLD_PDP="$CFG_PDP_TYPE"
OLD_AUTH="$CFG_AUTH"
OLD_USER="$CFG_USER"
OLD_PASSWORD="$CFG_PASSWORD"
AT_PORT="$CFG_AT_PORT"
WAN_IF="$CFG_WAN_IF"
OLD_IP="$(lte_ip_for_status)"

case "$PASSWORD_MODE" in
    keep) TARGET_PASSWORD="$OLD_PASSWORD" ;;
    replace) TARGET_PASSWORD="$SUBMITTED_PASSWORD" ;;
    clear) TARGET_PASSWORD="" ;;
    *) write_status failed validation "Modo de contraseña inválido" true false false; exit 5 ;;
esac
rm -f "$JOB_DIR/password"

if [ "$TARGET_AUTH" = "0" ]; then
    TARGET_USER=""
    TARGET_PASSWORD=""
fi

if [ "$TARGET_AUTH" != "0" ] && { [ -z "$TARGET_USER" ] || [ -z "$TARGET_PASSWORD" ]; }; then
    write_status failed validation "La autenticación seleccionada requiere usuario y contraseña" true false false
    exit 6
fi

[ -c "$AT_PORT" ] || { write_status failed safety "No está disponible el puerto AT $AT_PORT" true false false; exit 7; }
[ -x /etc/init.d/hoit_conn ] || { write_status failed safety "El servicio hoit_conn no está disponible" true false false; exit 8; }

STAMP="$(date +%Y%m%d_%H%M%S 2>/dev/null || echo manual)"
BACKUP_DIR="/data/hoit/backups/lte_apply_${STAMP}_${JOB_ID}"
mkdir -p "$BACKUP_DIR"
cp -a "$CONF" "$BACKUP_DIR/hoit_conn.conf"
[ -f /cache/hoit/gateway_status_current.json ] && cp -a /cache/hoit/gateway_status_current.json "$BACKUP_DIR/" || true

write_status running backup "Respaldando el perfil LTE actual" false false false
log "backup=$BACKUP_DIR target_apn=$TARGET_APN profile=$TARGET_PROFILE pdp=$TARGET_PDP auth=$TARGET_AUTH old_apn=$OLD_APN"

if ! write_config "$TARGET_APN" "$TARGET_PROFILE" "$TARGET_PDP" "$TARGET_AUTH" "$TARGET_USER" "$TARGET_PASSWORD"; then
    write_status failed validation "No fue posible guardar la configuración temporal LTE" true false false
    exit 9
fi

write_status running applying "Aplicando APN, autenticación y contexto PDP al módem" false false false
stop_conn
clear_lte_interface

if ! apply_modem_profile "$TARGET_APN" "$TARGET_PROFILE" "$TARGET_PDP" "$TARGET_AUTH" "$TARGET_USER" "$TARGET_PASSWORD"; then
    APPLY_REASON="El módem rechazó la configuración LTE"
else
    APPLY_REASON=""
    start_conn || APPLY_REASON="No fue posible iniciar hoit_conn"
fi

if [ -z "$APPLY_REASON" ]; then
    write_status running registration "Configuración aceptada; esperando registro e IP LTE" false false false
    if wait_for_lte; then
        [ -x /data/hoit/bin/hoit_wifi_manager.sh ] && /data/hoit/bin/hoit_wifi_manager.sh once >/dev/null 2>&1 || true
        write_status success completed "Perfil LTE guardado y acceso a Internet validado" true true false
        log "success apn=$TARGET_APN profile=$TARGET_PROFILE ip=$(lte_ip_for_status)"
        exit 0
    fi
    APPLY_REASON="El perfil fue aplicado, pero LTE no obtuvo Internet dentro del tiempo de prueba"
fi

write_status running rollback "$APPLY_REASON. Restaurando el perfil anterior" false false false
log "failure reason=$APPLY_REASON rollback old_apn=$OLD_APN"
stop_conn
cp -a "$BACKUP_DIR/hoit_conn.conf" "$CONF"
chmod 600 "$CONF"
load_active_config
AT_PORT="$CFG_AT_PORT"
WAN_IF="$CFG_WAN_IF"
clear_lte_interface
apply_modem_profile "$OLD_APN" "$OLD_PROFILE" "$OLD_PDP" "$OLD_AUTH" "$OLD_USER" "$OLD_PASSWORD" >> "$LOG" 2>&1 || true
start_conn || true

RESTORED=false
COUNT=0
while [ "$COUNT" -lt 18 ]; do
    sleep 5
    NOW_IP="$(lte_ip_for_status)"
    if [ -n "$NOW_IP" ]; then
        if [ -z "$OLD_IP" ] || internet_ok_v4 || internet_ok_v6; then
            RESTORED=true
            break
        fi
    elif [ -z "$OLD_IP" ] && /etc/init.d/hoit_conn status 2>/dev/null | grep -q running; then
        RESTORED=true
        break
    fi
    COUNT=$((COUNT + 1))
done

[ -x /data/hoit/bin/hoit_wifi_manager.sh ] && /data/hoit/bin/hoit_wifi_manager.sh once >/dev/null 2>&1 || true

if [ "$RESTORED" = true ]; then
    TARGET_APN="$OLD_APN"
    TARGET_PROFILE="$OLD_PROFILE"
    TARGET_PDP="$OLD_PDP"
    TARGET_AUTH="$OLD_AUTH"
    write_status failed rolled_back "$APPLY_REASON. El perfil LTE anterior fue restaurado" true false true
    log "rollback restored old_apn=$OLD_APN ip=$(lte_ip_for_status)"
else
    TARGET_APN="$OLD_APN"
    TARGET_PROFILE="$OLD_PROFILE"
    TARGET_PDP="$OLD_PDP"
    TARGET_AUTH="$OLD_AUTH"
    write_status failed rollback_failed "$APPLY_REASON. La configuración anterior fue repuesta, pero su conectividad no pudo confirmarse" true false false
    log "rollback not confirmed"
fi
exit 1
