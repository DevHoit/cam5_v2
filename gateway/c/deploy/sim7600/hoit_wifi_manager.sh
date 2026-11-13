#!/bin/sh

CONF="/data/hoit/config/hoit_wifi.conf"

if [ ! -f "$CONF" ]; then
    echo "ERROR: no existe $CONF"
    exit 1
fi

. "$CONF"

MANAGER_PID="$STATE_DIR/hoit_wifi_manager.pid"
LTE_GW_FILE="$STATE_DIR/lte.gateway"
LAST_STATE_FILE="$STATE_DIR/hoit_wifi.last_state"
STATUS_FILE="$CACHE_DIR/wifi_status.json"
LOG_FILE="$LOG_DIR/hoit_wifi.log"
DHCP_LOG="$LOG_DIR/udhcpc-wlan1.log"

mkdir -p "$STATE_DIR" "$CACHE_DIR" "$LOG_DIR" "$WPA_CTRL"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG_FILE"
}

json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

pid_running() {
    FILE="$1"
    PID="$(cat "$FILE" 2>/dev/null)"

    [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null
}

interface_exists() {
    iw dev "$WIFI_IF" info >/dev/null 2>&1
}

wifi_ip() {
    ip -4 addr show dev "$WIFI_IF" 2>/dev/null |
        awk '/inet / {print $2; exit}' |
        cut -d/ -f1
}

wifi_gateway() {
    awk '{print $1; exit}' "$STATE_DIR/wlan1.gateway" 2>/dev/null
}

wifi_ssid() {
    wpa_cli -p "$WPA_CTRL" -i "$WIFI_IF" status 2>/dev/null |
        awk -F= '/^ssid=/ {print substr($0,index($0,"=")+1); exit}'
}

wifi_completed() {
    wpa_cli -p "$WPA_CTRL" -i "$WIFI_IF" status 2>/dev/null |
        grep -q '^wpa_state=COMPLETED$'
}

remove_default_routes() {
    IFACE="$1"

    # El ip de busybox ignora el filtro "default" y lista todas las rutas: filtrar por línea.
    while ip route show 2>/dev/null |
        grep -qE "^default .*dev $IFACE( |$)"; do

        ip route del default dev "$IFACE" 2>/dev/null || break
    done
}

ensure_metric_route() {
    IFACE="$1"
    GATEWAY="$2"
    METRIC="$3"

    [ -z "$GATEWAY" ] && return 1

    # Antes contaba también la ruta de red y exigía un solo espacio antes de "metric": la ruta
    # nunca "coincidía" y se borraba y reinstalaba cada 15 s.
    ROUTE_COUNT="$(ip route show 2>/dev/null |
        grep -cE "^default .*dev $IFACE( |$)")"

    GOOD_COUNT="$(ip route show 2>/dev/null |
        grep -cE "^default via $GATEWAY dev $IFACE +metric $METRIC( |$)")"

    if [ "$ROUTE_COUNT" != "1" ] || [ "$GOOD_COUNT" != "1" ]; then
        remove_default_routes "$IFACE"

        ip route add default \
            via "$GATEWAY" \
            dev "$IFACE" \
            metric "$METRIC" 2>/dev/null
    fi
}

capture_lte_gateway() {
    CURRENT="$(ip route show default 2>/dev/null |
        awk -v iface="$LTE_IF" '
            $0 ~ ("dev " iface) {
                for(i=1;i<=NF;i++){
                    if($i=="via"){
                        print $(i+1)
                        exit
                    }
                }
            }
        ')"

    if [ -n "$CURRENT" ]; then
        printf '%s\n' "$CURRENT" > "$LTE_GW_FILE"
    fi
}

normalize_lte_route() {
    LTE_GW="$(cat "$LTE_GW_FILE" 2>/dev/null)"
    LTE_IP="$(ip -4 addr show dev "$LTE_IF" 2>/dev/null |
        awk '/inet / {print $2; exit}')"

    if [ -n "$LTE_GW" ] && [ -n "$LTE_IP" ]; then
        ensure_metric_route "$LTE_IF" "$LTE_GW" "$LTE_METRIC"
    fi
}

ensure_interface() {
    if ! interface_exists; then
        log "Creando interfaz $WIFI_IF en modo managed"

        iw phy "$WIFI_PHY" interface add "$WIFI_IF" type managed ||
            return 1
    fi

    ip link set "$WIFI_IF" up 2>/dev/null
}

ensure_wpa() {
    if pid_running "$WPA_PID"; then
        return 0
    fi

    rm -f "$WPA_PID"
    rm -f "$WPA_CTRL/$WIFI_IF"

    log "Iniciando wpa_supplicant en $WIFI_IF"

    wpa_supplicant \
        -B \
        -Dnl80211 \
        -i "$WIFI_IF" \
        -c "$WPA_CONF" \
        -P "$WPA_PID" >> "$LOG_FILE" 2>&1
}

ensure_dhcp() {
    IP="$(wifi_ip)"

    if [ -n "$IP" ]; then
        return 0
    fi

    if pid_running "$DHCP_PID"; then
        return 0
    fi

    rm -f "$DHCP_PID"

    log "Solicitando dirección DHCP para $WIFI_IF"

    udhcpc \
        -i "$WIFI_IF" \
        -p "$DHCP_PID" \
        -s "$DHCP_SCRIPT" >> "$DHCP_LOG" 2>&1 &
}

# Prueba el Wi-Fi sin reinstalar su ruta por defecto: se agregan rutas temporales solo hacia
# los hosts de prueba. Así, mientras el Wi-Fi está sin internet, el resto del tráfico sigue
# por 4G en vez de caer en el Wi-Fi durante cada prueba.
wifi_host_route() {
    # $1 add|del  $2 IP destino
    [ -n "$CHK_GW" ] || return 1
    ip route "$1" "$2" via "$CHK_GW" dev "$WIFI_IF" 2>/dev/null
}

check_wifi_internet() {
    IP="$(wifi_ip)"

    [ -z "$IP" ] && return 1

    CHK_GW="$(wifi_gateway)"
    CHK_RC=1

    if wifi_host_route add "$CHECK_HOST"; then CHK_TMP=1; else CHK_TMP=0; fi
    ping \
        -I "$WIFI_IF" \
        -c 2 \
        -W 3 \
        "$CHECK_HOST" >/dev/null 2>&1 && CHK_RC=0
    [ "$CHK_TMP" = "1" ] && wifi_host_route del "$CHECK_HOST"
    [ "$CHK_RC" = "0" ] && return 0

    # Redes que bloquean ICMP: HTTPS al host de CHECK_URL, también por ruta temporal.
    CHK_HOST="$(printf '%s' "$CHECK_URL" | sed -E 's#^[a-z]+://([^/:]+).*#\1#')"
    CHK_IP="$(nslookup "$CHK_HOST" 2>/dev/null |
        awk '/^Name:/{n=1} n && /^Address [0-9]+: [0-9.]+$/{print $3; exit}')"
    [ -n "$CHK_IP" ] || return 1
    if wifi_host_route add "$CHK_IP"; then CHK_TMP=1; else CHK_TMP=0; fi
    curl \
        --interface "$WIFI_IF" \
        --resolve "$CHK_HOST:443:$CHK_IP" \
        -k \
        -s \
        --connect-timeout 5 \
        --max-time 10 \
        -o /dev/null \
        "$CHECK_URL" >/dev/null 2>&1 && CHK_RC=0
    [ "$CHK_TMP" = "1" ] && wifi_host_route del "$CHK_IP"

    return "$CHK_RC"
}

active_interface() {
    ip route get "$CHECK_HOST" 2>/dev/null |
        awk '{
            for(i=1;i<=NF;i++){
                if($i=="dev"){
                    print $(i+1)
                    exit
                }
            }
        }'
}

write_status() {
    STATE="$1"
    IP="$(wifi_ip)"
    GATEWAY="$(wifi_gateway)"
    SSID="$(wifi_ssid)"
    ACTIVE="$(active_interface)"
    LTE_GW="$(cat "$LTE_GW_FILE" 2>/dev/null)"
    NOW="$(date +%s 2>/dev/null)"

    cat > "$STATUS_FILE.tmp" <<JSON
{
  "ok": true,
  "state": "$(json_escape "$STATE")",
  "interface": "$(json_escape "$WIFI_IF")",
  "ssid": "$(json_escape "$SSID")",
  "ip": "$(json_escape "$IP")",
  "gateway": "$(json_escape "$GATEWAY")",
  "active_interface": "$(json_escape "$ACTIVE")",
  "wifi_metric": $WIFI_METRIC,
  "lte_interface": "$(json_escape "$LTE_IF")",
  "lte_gateway": "$(json_escape "$LTE_GW")",
  "lte_metric": $LTE_METRIC,
  "updated_epoch": ${NOW:-0}
}
JSON

    mv "$STATUS_FILE.tmp" "$STATUS_FILE"
}

set_state() {
    NEW_STATE="$1"
    OLD_STATE="$(cat "$LAST_STATE_FILE" 2>/dev/null)"

    if [ "$NEW_STATE" != "$OLD_STATE" ]; then
        log "Estado WiFi: $OLD_STATE -> $NEW_STATE"
        printf '%s\n' "$NEW_STATE" > "$LAST_STATE_FILE"
    fi

    write_status "$NEW_STATE"
}

run_cycle() {
    capture_lte_gateway
    normalize_lte_route

    if ! ensure_interface; then
        remove_default_routes "$WIFI_IF"
        set_state "interface_error"
        return
    fi

    if ! ensure_wpa; then
        remove_default_routes "$WIFI_IF"
        set_state "wpa_error"
        return
    fi

    if ! wifi_completed; then
        remove_default_routes "$WIFI_IF"
        normalize_lte_route
        set_state "connecting"
        return
    fi

    ensure_dhcp

    IP="$(wifi_ip)"
    GATEWAY="$(wifi_gateway)"

    if [ -z "$IP" ] || [ -z "$GATEWAY" ]; then
        remove_default_routes "$WIFI_IF"
        normalize_lte_route
        set_state "waiting_dhcp"
        return
    fi

    # Primero se prueba y después se instala la ruta (antes se instalaba, se probaba y se
    # retiraba: con el Wi-Fi sin internet, el tráfico caía en él la mayor parte de cada ciclo).
    if check_wifi_internet; then
        ensure_metric_route "$WIFI_IF" "$GATEWAY" "$WIFI_METRIC"
        normalize_lte_route
        set_state "connected"
    else
        [ "$(cat "$LAST_STATE_FILE" 2>/dev/null)" = "no_internet" ] ||
            log "WiFi asociado, pero sin Internet. Retirando ruta principal."
        remove_default_routes "$WIFI_IF"
        normalize_lte_route
        set_state "no_internet"
    fi
}

cleanup() {
    remove_default_routes "$WIFI_IF"

    if pid_running "$DHCP_PID"; then
        kill "$(cat "$DHCP_PID")" 2>/dev/null
    fi

    if pid_running "$WPA_PID"; then
        kill "$(cat "$WPA_PID")" 2>/dev/null
    fi

    rm -f "$DHCP_PID" "$WPA_PID"
    sleep 1

    iw dev "$WIFI_IF" del 2>/dev/null

    normalize_lte_route
    set_state "stopped"
}

case "$1" in
    run)
        echo $$ > "$MANAGER_PID"
        log "HOIT WiFi Manager iniciado"

        trap 'log "HOIT WiFi Manager detenido"; exit 0' TERM INT

        while true; do
            run_cycle
            sleep "$CHECK_INTERVAL"
        done
        ;;

    once)
        run_cycle
        ;;

    cleanup)
        cleanup
        ;;

    status)
        if pid_running "$MANAGER_PID"; then
            echo "running"
            [ -f "$STATUS_FILE" ] && cat "$STATUS_FILE"
        else
            echo "stopped"
            [ -f "$STATUS_FILE" ] && cat "$STATUS_FILE"
        fi
        ;;

    *)
        echo "Uso: $0 {run|once|cleanup|status}"
        exit 1
        ;;
esac
