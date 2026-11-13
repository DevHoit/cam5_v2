#!/bin/sh
# HoitLive — vigilancia de conectividad del SIM7600 (Wi-Fi + 4G) con reconexión escalonada.
#
# Reemplaza a /data/hoit/bin/hoit_conn_watchdog.sh y conserva su interfaz:
#   hoit_conn_watchdog.sh once         un ciclo (lo llama hoit_conn_runner.sh cada CHECK_INTERVAL)
#   hoit_conn_watchdog.sh reconnect    reinicio manual de la radio 4G
#   hoit_conn_watchdog.sh status-json  estado actual sin acciones de recuperación
#
# Qué hace en cada ciclo:
#   1. Prueba cada salida por separado (ping -I y HTTPS con --interface): Wi-Fi y 4G.
#      El 4G en reserva se prueba cada LTE_STANDBY_PROBE ciclos para no gastar datos;
#      si el 4G es la salida activa y está recibiendo tráfico, no se prueba.
#   2. Lee el estado del módem por AT (SIM, registro, tecnología, señal, contexto PDP),
#      con bloqueo para no chocar con otros procesos que usan el mismo puerto.
#   3. Si el 4G falla, escala: reactivar el contexto PDP → reiniciar la radio (CFUN 4/1),
#      luego repetir el reinicio de radio cada RADIO_RESET_EVERY ciclos.
#   4. Si no hay NINGUNA salida durante REBOOT_AFTER ciclos, reinicia el equipo
#      (máximo REBOOT_MAX_PER_DAY veces en 24 h y nunca antes de MIN_UPTIME_FOR_REBOOT).
#   5. Mantiene el cortafuegos: bloquea ADB por red y la administración por 4G.
#   6. Escribe /cache/hoit/gateway_status_current.json (formato que lee el portal).

CONF="/data/hoit/config/hoit_conn.conf"
[ -f "$CONF" ] && . "$CONF"

DEVICE_ID="${DEVICE_ID:-SIM7600}"
AT_PORT="${AT_PORT:-/dev/smd8}"
WAN_IF="${WAN_IF:-rmnet_data0}"
WIFI_IF="${WIFI_IF:-wlan1}"
# APN definido pero vacío = SIM sin APN: el perfil se deja vacío para que la red asigne el suyo.
APN_SET="${APN+1}"
APN="${APN:-}"
PROFILE_ID="${PROFILE_ID:-6}"
PDP_TYPE="${PDP_TYPE:-IP}"
CHECK_INTERVAL="${CHECK_INTERVAL:-60}"
PROBE_TARGETS="${PROBE_TARGETS:-1.1.1.1 8.8.8.8}"
PROBE_URL="${PROBE_URL:-https://core.hoitlive.com/api/v1/gateway/heartbeat}"
CA_FILE="${CA_FILE:-/cache/cam5-gateway/ca-certificates.crt}"
LTE_STANDBY_PROBE="${LTE_STANDBY_PROBE:-5}"
PDP_RESET_AFTER="${PDP_RESET_AFTER:-3}"
RADIO_RESET_AFTER="${RADIO_RESET_AFTER:-8}"
RADIO_RESET_EVERY="${RADIO_RESET_EVERY:-30}"
REBOOT_AFTER="${REBOOT_AFTER:-45}"
REBOOT_MAX_PER_DAY="${REBOOT_MAX_PER_DAY:-3}"
MIN_UPTIME_FOR_REBOOT="${MIN_UPTIME_FOR_REBOOT:-1800}"
FIREWALL="${FIREWALL:-1}"
# Interfaces que nunca deben ser salida a internet (QCMAP agrega "default dev eth0" si el
# cable del CAM-5 está conectado al arrancar, y eso deja al equipo sin salida).
NO_DEFAULT_IFS="${NO_DEFAULT_IFS:-eth0}"
LTE_METRIC="${LTE_METRIC:-600}"
# hoit_wifi_manager reconstruye la ruta 4G con este archivo cada 15 s: debe tener la puerta actual.
LTE_GW_FILE="${LTE_GW_FILE:-/data/hoit/state/lte.gateway}"
CACHE_DIR="${CACHE_DIR:-/cache/hoit}"
LOG_FILE="${NETWATCH_LOG:-/cache/hoit/netwatch.log}"
LOG_MAX_BYTES="${LOG_MAX_BYTES:-262144}"

RUN_DIR="/var/run/hoit_netwatch"          # contadores (RAM: se reinician con el equipo)
REBOOT_HISTORY="/cache/hoit/netwatch_reboots"  # persistente
STATUS_JSON="$CACHE_DIR/gateway_status_current.json"
LOCK_FILE="/var/lock/hoit_at.lock"

mkdir -p "$RUN_DIR" "$CACHE_DIR" /var/lock 2>/dev/null

# ---------------------------------------------------------------- utilidades

log() {
    if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)" -gt "$LOG_MAX_BYTES" ]; then
        mv -f "$LOG_FILE" "$LOG_FILE.1"
    fi
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

get_n() { cat "$RUN_DIR/$1" 2>/dev/null || echo 0; }
set_n() { echo "$2" > "$RUN_DIR/$1"; }
inc_n() { set_n "$1" $(( $(get_n "$1") + 1 )); }
get_s() { cat "$RUN_DIR/$1" 2>/dev/null; }

json_escape() { printf '%s' "$1" | tr -d '\r\n' | sed 's/\\/\\\\/g; s/"/\\"/g'; }

nap() { usleep "$1" 2>/dev/null || sleep 1; }   # microsegundos

uptime_s() { awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0; }

iface_ip() { ip -4 addr show dev "$1" 2>/dev/null | awk '/inet /{split($2,a,"/"); print a[1]; exit}'; }

rx_bytes() { cat "/sys/class/net/$1/statistics/rx_bytes" 2>/dev/null || echo 0; }

# Comando AT con bloqueo exclusivo del puerto y lector propio (no mata otros procesos).
at_cmd() {
    CMD="$1"; WAIT="${2:-3}"
    (
        flock -x 9 || exit 1
        OUT="$RUN_DIR/at.$$"
        : > "$OUT"
        cat "$AT_PORT" > "$OUT" 2>/dev/null &
        RP=$!
        nap 200000
        printf '%s\r' "$CMD" > "$AT_PORT" 2>/dev/null
        I=0
        while [ "$I" -lt $((WAIT * 5)) ]; do
            grep -qE '^(OK|ERROR|\+CME ERROR)' "$OUT" 2>/dev/null && break
            nap 200000
            I=$((I + 1))
        done
        kill "$RP" 2>/dev/null; wait "$RP" 2>/dev/null
        tr -d '\r' < "$OUT"
        rm -f "$OUT"
    ) 9>"$LOCK_FILE"
}

at_value() { printf '%s\n' "$1" | grep "$2" | head -1 | sed "s/^.*$2 *//"; }

# ---------------------------------------------------------------- pruebas

probe_iface() {
    IF="$1"
    [ -n "$(iface_ip "$IF")" ] || return 1
    for T in $PROBE_TARGETS; do
        ping -I "$IF" -c 1 -W 4 "$T" >/dev/null 2>&1 && return 0
    done
    # Algunos APN IoT bloquean ICMP: probar HTTPS al portal por esa interfaz.
    if [ -r "$CA_FILE" ]; then TLS="--cacert $CA_FILE"; else TLS="-k"; fi
    CODE="$(curl -s -o /dev/null $TLS --interface "$IF" --connect-timeout 8 --max-time 15 \
        -w '%{http_code}' "$PROBE_URL" 2>/dev/null)"
    case "$CODE" in [1-5][0-9][0-9]) return 0 ;; esac
    return 1
}

active_uplink() { ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}'; }

# ---------------------------------------------------------------- módem

read_modem() {
    SIM="$(at_value "$(at_cmd 'AT+CPIN?')" '+CPIN:')"
    [ -n "$SIM" ] || SIM="sin_respuesta"
    CPSI="$(at_value "$(at_cmd 'AT+CPSI?')" '+CPSI:')"
    RAT="$(echo "$CPSI" | cut -d, -f1)"
    CSQ="$(at_value "$(at_cmd 'AT+CSQ')" '+CSQ:')"
    RSSI="$(echo "$CSQ" | cut -d, -f1 | tr -d ' ')"
    BER="$(echo "$CSQ" | cut -d, -f2 | tr -d ' ')"
    OPERATOR="$(at_value "$(at_cmd 'AT+COPS?')" '+COPS:' | sed -n 's/.*"\([^"]*\)".*/\1/p')"
    CREG="$(at_value "$(at_cmd 'AT+CREG?')" '+CREG:')"
    CEREG="$(at_value "$(at_cmd 'AT+CEREG?')" '+CEREG:')"
    CGATT="$(at_value "$(at_cmd 'AT+CGATT?')" '+CGATT:')"
    REGISTERED=0
    for R in "$CREG" "$CEREG"; do
        case "$(echo "$R" | cut -d, -f2 | tr -d ' ')" in 1|5) REGISTERED=1 ;; esac
    done
    ROAMING=0
    case "$(echo "$CREG" | cut -d, -f2 | tr -d ' ')$(echo "$CEREG" | cut -d, -f2 | tr -d ' ')" in *5*) ROAMING=1 ;; esac
    # Identificadores: se leen una vez por arranque, y de nuevo si la SIM se cambió en caliente
    # (mientras no está READY se descarta lo guardado para no mostrar el ICCID de la anterior).
    [ "$SIM" = "READY" ] || rm -f "$RUN_DIR/iccid" "$RUN_DIR/imsi_prefix"
    if [ "$SIM" = "READY" ] && [ ! -s "$RUN_DIR/iccid" ]; then
        at_value "$(at_cmd 'AT+CCID')" '+CCID:' | tr -d ' "' > "$RUN_DIR/iccid"
        at_cmd 'AT+CGSN' | grep -E '^[0-9]{14,}' | head -1 > "$RUN_DIR/imei"
        at_cmd 'AT+CIMI' | grep -E '^[0-9]{10,}' | head -1 | cut -c1-6 > "$RUN_DIR/imsi_prefix"
    fi
}

ensure_apn() {
    [ -n "$APN" ] || [ "$APN_SET" = "1" ] || return 0
    CUR="$(at_cmd 'AT+CGDCONT?' | grep "^+CGDCONT: $PROFILE_ID," | cut -d'"' -f4)"
    if [ "$CUR" != "$APN" ]; then
        log "APN del perfil $PROFILE_ID era \"$CUR\"; se configura \"$APN\""
        at_cmd "AT+CGDCONT=$PROFILE_ID,\"$PDP_TYPE\",\"$APN\"" >/dev/null
    fi
}

pdp_reset() {
    log "4G: reactivando contexto PDP $PROFILE_ID"
    ensure_apn
    at_cmd 'AT+CGATT=1' 10 >/dev/null
    at_cmd "AT+CGACT=0,$PROFILE_ID" 15 >/dev/null
    sleep 3
    at_cmd "AT+CGACT=1,$PROFILE_ID" 30 >/dev/null
    set_s last_action "pdp_reset"
}

radio_reset() {
    log "4G: reiniciando la radio (CFUN=4 → CFUN=1)"
    ensure_apn
    at_cmd 'AT+CFUN=4' 15 >/dev/null
    sleep 5
    at_cmd 'AT+CFUN=1' 15 >/dev/null
    set_s last_action "radio_reset"
    set_n last_radio_reset "$(get_n cycle)"
}

set_s() { echo "$2" > "$RUN_DIR/$1"; }

# ---------------------------------------------------------------- rutas

ensure_routes() {
    for IF in $NO_DEFAULT_IFS; do
        N=0
        while ip route show 2>/dev/null | grep -qE "^default .*dev $IF( |$)" && [ "$N" -lt 5 ]; do
            ip route del default dev "$IF" 2>/dev/null
            N=$((N + 1))
        done
        [ "$N" -gt 0 ] && log "Ruta por defecto por $IF eliminada (es la red del CAM-5, no una salida a internet)"
    done
}

# Ruta de respaldo por 4G (métrica alta: el Wi-Fi, con métrica 100, tiene prioridad).
# El enlace rmnet es un /30 punto a punto: la puerta es la otra dirección del bloque.
lte_peer() {
    ip -4 addr show dev "$WAN_IF" 2>/dev/null | awk '/inet /{
        split($2, a, "/"); split(a[1], o, ".");
        if (a[2] != 30) exit;
        net = o[4] - (o[4] % 4); peer = (o[4] == net + 1) ? net + 2 : net + 1;
        print o[1] "." o[2] "." o[3] "." peer; exit }'
}

ensure_lte_route() {
    [ -n "$LTE_IP" ] || return 0
    GW="$(lte_peer)"
    [ -n "$GW" ] || return 0
    [ "$(cat "$LTE_GW_FILE" 2>/dev/null)" = "$GW" ] || echo "$GW" > "$LTE_GW_FILE"
    if ! ip route show 2>/dev/null | grep -qE "^default via $GW dev $WAN_IF +metric $LTE_METRIC"; then
        while ip route show 2>/dev/null | grep -qE "^default .*dev $WAN_IF( |$)"; do
            ip route del default dev "$WAN_IF" 2>/dev/null || break
        done
        ip route add default via "$GW" dev "$WAN_IF" metric "$LTE_METRIC" 2>/dev/null &&
            log "Ruta de respaldo 4G: default via $GW dev $WAN_IF metric $LTE_METRIC"
    fi
}

# Lectores huérfanos del puerto AT (de la versión anterior) se roban las respuestas.
kill_stale_at_readers() {
    for PID in $(ps | grep "[c]at $AT_PORT" | awk '{print $1}'); do
        kill "$PID" 2>/dev/null
    done
}

# ---------------------------------------------------------------- cortafuegos

ensure_firewall() {
    [ "$FIREWALL" = "1" ] || return 0
    command -v iptables >/dev/null 2>&1 || return 0
    # Cortafuegos completo (IPv4/IPv6, Wi-Fi corporativo, reenvíos): ver hoit_firewall.sh.
    if [ -x /data/hoit/bin/hoit_firewall.sh ]; then
        /data/hoit/bin/hoit_firewall.sh apply >/dev/null 2>&1
        return 0
    fi
    iptables -N HOIT_GUARD 2>/dev/null
    iptables -C INPUT -j HOIT_GUARD 2>/dev/null || iptables -I INPUT 1 -j HOIT_GUARD
    if ! iptables -C HOIT_GUARD -p tcp --dport 5565 -j DROP 2>/dev/null; then
        iptables -F HOIT_GUARD
        iptables -A HOIT_GUARD -i lo -j RETURN
        # adbd escucha en TCP 5565 sin autenticación: solo se permite por USB.
        iptables -A HOIT_GUARD -p tcp --dport 5565 -j DROP
        # Sin administración (SSH ni portal) desde la red celular.
        iptables -A HOIT_GUARD -i rmnet+ -p tcp --dport 22 -j DROP
        iptables -A HOIT_GUARD -i rmnet+ -p tcp --dport 80 -j DROP
        log "Cortafuegos aplicado (ADB por red bloqueado; SSH/portal cerrados por 4G)"
    fi
}

# ---------------------------------------------------------------- reinicio

reboots_last_day() {
    NOW="$(date +%s)"
    [ -f "$REBOOT_HISTORY" ] || { echo 0; return; }
    awk -v now="$NOW" '$1 > now - 86400' "$REBOOT_HISTORY" | wc -l | tr -d ' '
}

maybe_reboot() {
    NONE="$(get_n no_uplink)"
    [ "$NONE" -ge "$REBOOT_AFTER" ] || return 0
    [ "$(uptime_s)" -ge "$MIN_UPTIME_FOR_REBOOT" ] || return 0
    COUNT="$(reboots_last_day)"
    if [ "$COUNT" -ge "$REBOOT_MAX_PER_DAY" ]; then
        [ $((NONE % 60)) -eq 0 ] && log "Sin salida a internet hace $NONE ciclos; límite de $REBOOT_MAX_PER_DAY reinicios/24 h alcanzado"
        return 0
    fi
    log "Sin salida a internet hace $NONE ciclos: reiniciando el equipo ($((COUNT + 1))/$REBOOT_MAX_PER_DAY en 24 h)"
    date +%s >> "$REBOOT_HISTORY"
    tail -20 "$REBOOT_HISTORY" > "$REBOOT_HISTORY.tmp" && mv -f "$REBOOT_HISTORY.tmp" "$REBOOT_HISTORY"
    sync
    reboot
    exit 0
}

# ---------------------------------------------------------------- estado

write_status() {
    TMP="$STATUS_JSON.tmp.$$"
    cat > "$TMP" <<EOF
{
  "device_id": "$(json_escape "$DEVICE_ID")",
  "reported_at": "$(date '+%Y-%m-%dT%H:%M:%S%z')",
  "connection": {
    "wan_if": "$(json_escape "$WAN_IF")",
    "ip_address": "$(json_escape "$LTE_IP")",
    "wan_ok": $([ -n "$LTE_IP" ] && echo 1 || echo 0),
    "internet_ok": $LTE_OK,
    "http_ok": $LTE_OK,
    "apn": "$(json_escape "$APN")",
    "profile_id": "$(json_escape "$PROFILE_ID")"
  },
  "modem": {
    "sim": "$(json_escape "$SIM")",
    "network_error": "$(json_escape "$CEER")",
    "operator": "$(json_escape "$OPERATOR")",
    "rat": "$(json_escape "$RAT")",
    "rssi": "$(json_escape "$RSSI")",
    "ber": "$(json_escape "$BER")",
    "roaming": $ROAMING,
    "iccid": "$(json_escape "$(cat "$RUN_DIR/iccid" 2>/dev/null)")",
    "imei": "$(json_escape "$(cat "$RUN_DIR/imei" 2>/dev/null)")",
    "imsi_prefix": "$(json_escape "$(cat "$RUN_DIR/imsi_prefix" 2>/dev/null)")"
  },
  "registration": {
    "cgatt": "$(json_escape "+CGATT: $CGATT")",
    "cereg": "$(json_escape "+CEREG: $CEREG")",
    "creg": "$(json_escape "+CREG: $CREG")"
  },
  "netwatch": {
    "uplink": "$(json_escape "$UPLINK")",
    "wifi_ip": "$(json_escape "$WIFI_IP")",
    "wifi_ok": $WIFI_OK,
    "lte_ok": $LTE_OK,
    "lte_state": "$(json_escape "$LTE_STATE")",
    "lte_fail_cycles": $(get_n lte_fail),
    "no_uplink_cycles": $(get_n no_uplink),
    "last_action": "$(json_escape "$(get_s last_action)")",
    "reboots_24h": $(reboots_last_day),
    "check_interval_s": $CHECK_INTERVAL
  }
}
EOF
    mv -f "$TMP" "$STATUS_JSON"
}

# ---------------------------------------------------------------- ciclo

single_cycle() {
    inc_n cycle
    CYCLE="$(get_n cycle)"
    [ "$CYCLE" -eq 1 ] && kill_stale_at_readers
    ensure_routes
    ensure_firewall

    WIFI_IP="$(iface_ip "$WIFI_IF")"
    LTE_IP="$(iface_ip "$WAN_IF")"
    ensure_lte_route
    UPLINK="$(active_uplink)"

    WIFI_OK=0
    CEER=""
    [ -n "$WIFI_IP" ] && probe_iface "$WIFI_IF" && WIFI_OK=1

    # 4G: si es la salida activa y recibió tráfico desde el ciclo anterior, está sano.
    RX_NOW="$(rx_bytes "$WAN_IF")"; RX_PREV="$(get_n lte_rx)"; set_n lte_rx "$RX_NOW"
    LTE_OK="$(get_n lte_ok_last)"
    if [ -z "$LTE_IP" ]; then
        LTE_OK=0
    elif [ "$UPLINK" = "$WAN_IF" ] && [ "$RX_NOW" -gt "$RX_PREV" ] && [ "$RX_PREV" -gt 0 ]; then
        LTE_OK=1
    elif [ "$UPLINK" = "$WAN_IF" ] || [ "$(get_n lte_fail)" -gt 0 ] || [ $((CYCLE % LTE_STANDBY_PROBE)) -eq 0 ]; then
        LTE_OK=0; probe_iface "$WAN_IF" && LTE_OK=1
    fi
    set_n lte_ok_last "$LTE_OK"

    read_modem

    if [ "$LTE_OK" = "1" ]; then
        [ "$(get_n lte_fail)" -gt 0 ] && log "4G recuperado tras $(get_n lte_fail) ciclo(s) con falla ($RAT, $OPERATOR, CSQ $RSSI)"
        set_n lte_fail 0
        LTE_STATE="ok"
    else
        inc_n lte_fail
        F="$(get_n lte_fail)"
        SINCE_RADIO=$((CYCLE - $(get_n last_radio_reset)))
        case "$SIM" in
            READY)
                if [ "$REGISTERED" != "1" ]; then LTE_STATE="sin_registro"
                elif [ -z "$LTE_IP" ]; then
                    # Motivo que dio la red al rechazar la sesión de datos (p. ej. plan inactivo).
                    CEER="$(at_value "$(at_cmd 'AT+CEER')" '+CEER:')"
                    case "$CEER" in
                        *[Nn]ot\ subscribed*|*[Uu]nknown\ APN*|*[Mm]issing\ or\ unknown\ APN*|*[Aa]uthentication*)
                            LTE_STATE="rechazado_por_red" ;;
                        *) LTE_STATE="sin_ip" ;;
                    esac
                else LTE_STATE="sin_trafico"; fi ;;
            *) LTE_STATE="sim_no_lista" ;;
        esac
        [ "$F" -eq 1 ] && log "4G con falla: $LTE_STATE (SIM $SIM, $RAT, ${OPERATOR:-sin operador}, CSQ ${RSSI:-?}, IP ${LTE_IP:-ninguna}${CEER:+, red: $CEER})"
        if [ "$LTE_STATE" = "rechazado_por_red" ] && [ "$(get_s last_ceer)" != "$CEER" ]; then
            log "4G: la red rechaza la sesión de datos: \"$CEER\". Revisar plan/APN de la SIM (APN=$APN)"
        fi
        set_s last_ceer "$CEER"
        if [ "$LTE_STATE" = "sim_no_lista" ]; then
            # Sin SIM utilizable: solo reintentar la radio de vez en cuando.
            [ "$SINCE_RADIO" -ge "$RADIO_RESET_EVERY" ] && radio_reset
        elif [ "$F" -eq "$PDP_RESET_AFTER" ] && [ "$REGISTERED" = "1" ]; then
            pdp_reset
        elif [ "$F" -eq "$RADIO_RESET_AFTER" ] || { [ "$F" -gt "$RADIO_RESET_AFTER" ] && [ "$SINCE_RADIO" -ge "$RADIO_RESET_EVERY" ]; }; then
            radio_reset
        fi
    fi

    if [ "$WIFI_OK" = "1" ] || [ "$LTE_OK" = "1" ]; then
        [ "$(get_n no_uplink)" -gt 0 ] && log "Salida a internet restablecida (Wi-Fi=$WIFI_OK, 4G=$LTE_OK)"
        set_n no_uplink 0
    else
        inc_n no_uplink
        [ "$(get_n no_uplink)" -eq 1 ] && log "Sin salida a internet por ninguna interfaz"
    fi

    write_status
    maybe_reboot
}

case "$1" in
    once) single_cycle ;;
    reconnect) radio_reset ;;
    status-json)
        WIFI_IP="$(iface_ip "$WIFI_IF")"; LTE_IP="$(iface_ip "$WAN_IF")"; UPLINK="$(active_uplink)"
        WIFI_OK=0; [ -n "$WIFI_IP" ] && probe_iface "$WIFI_IF" && WIFI_OK=1
        LTE_OK="$(get_n lte_ok_last)"; LTE_STATE="consulta"
        read_modem; write_status; cat "$STATUS_JSON" ;;
    *) echo "Uso: $0 {once|reconnect|status-json}"; exit 1 ;;
esac
