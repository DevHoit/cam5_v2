#!/bin/sh

. /data/hoit/lib/portal_auth.sh || exit 1
pa_require_session

# HOIT Gateway Portal - conectividad real (solo lectura)
# No ejecuta comandos AT, no modifica rutas y no cambia configuraciones.

echo "Content-Type: application/json"
echo "Cache-Control: no-store"
echo "X-Content-Type-Options: nosniff"
echo ""

GW_FILE="/cache/hoit/gateway_status_current.json"
WIFI_STATUS_FILE="/cache/hoit/wifi_status.json"
WIFI_CONF="/data/hoit/config/hoit_wifi.conf"
LTE_CONF="/data/hoit/config/hoit_conn.conf"
HOSTAPD_CONF="/etc/hostapd.conf"
WPA_CTRL="/data/hoit/state/wpa_supplicant"

json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\r//g; :a;N;$!ba;s/\n/\\n/g'
}

bool_interface_exists() {
    ip link show "$1" >/dev/null 2>&1 && printf true || printf false
}

bool_interface_up() {
    ip link show "$1" 2>/dev/null | grep -q '<[^>]*UP' && printf true || printf false
}

init_service_state() {
    NAME="$1"
    if [ -x "/etc/init.d/$NAME" ] && "/etc/init.d/$NAME" status 2>/dev/null | grep -q running; then
        printf running
    else
        printf stopped
    fi
}

process_state() {
    PATTERN="$1"
    if ps | grep "$PATTERN" | grep -v grep >/dev/null 2>&1; then
        printf running
    else
        printf stopped
    fi
}

ipv4_cidr() {
    ip -4 addr show dev "$1" 2>/dev/null | awk '/inet / {print $2; exit}'
}

ipv4_only() {
    ipv4_cidr "$1" | cut -d/ -f1
}

mac_addr() {
    cat "/sys/class/net/$1/address" 2>/dev/null
}

default_gateway() {
    ip route show default 2>/dev/null | awk -v iface="$1" '
        $0 ~ (" dev " iface "( |$)") {
            for(i=1;i<=NF;i++) if($i=="via") {print $(i+1); exit}
        }'
}

default_metric() {
    ip route show default 2>/dev/null | awk -v iface="$1" '
        $0 ~ (" dev " iface "( |$)") {
            for(i=1;i<=NF;i++) if($i=="metric") {print $(i+1); exit}
            print 0; exit
        }'
}

lease_value() {
    MAC="$1"
    FIELD="$2"
    for FILE in /var/lib/misc/dnsmasq.leases /data/dnsmasq.leases /tmp/dnsmasq.leases; do
        [ -r "$FILE" ] || continue
        VALUE="$(awk -v mac="$MAC" -v field="$FIELD" 'tolower($2)==tolower(mac) {print $field; exit}' "$FILE" 2>/dev/null)"
        [ -n "$VALUE" ] && { printf '%s' "$VALUE"; return; }
    done
}

if [ -s "$GW_FILE" ]; then
    GATEWAY_JSON="$(cat "$GW_FILE")"
else
    GATEWAY_JSON='{}'
fi

if [ -s "$WIFI_STATUS_FILE" ]; then
    WIFI_STATUS_JSON="$(cat "$WIFI_STATUS_FILE")"
else
    WIFI_STATUS_JSON='{}'
fi

GENERATED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)"
DNS_LIST="$(awk '/^nameserver / {if(out!="") out=out", "; out=out $2} END{print out}' /etc/resolv.conf 2>/dev/null)"

# Salida activa = ruta por defecto de menor métrica. No se usa "ip route get 8.8.8.8": el gestor de Wi-Fi
# agrega por unos segundos una ruta a 8.8.8.8 por wlan1 para probar su Internet y el portal mostraba la
# salida alternando entre Wi-Fi y 4G aunque el tráfico seguía por la ruta principal.
ACTIVE_LINE="$(ip route show default 2>/dev/null | awk '{m=0; for(i=1;i<=NF;i++) if($i=="metric") m=$(i+1); print m " " $0}' | sort -n | head -n 1 | cut -d' ' -f2-)"
ACTIVE_IF="$(printf '%s\n' "$ACTIVE_LINE" | awk '{for(i=1;i<=NF;i++) if($i=="dev") {print $(i+1); exit}}')"
ACTIVE_GW="$(printf '%s\n' "$ACTIVE_LINE" | awk '{for(i=1;i<=NF;i++) if($i=="via") {print $(i+1); exit}}')"
ACTIVE_SRC="$([ -n "$ACTIVE_IF" ] && ip -4 addr show dev "$ACTIVE_IF" 2>/dev/null | awk '/inet /{split($2,a,"/"); print a[1]; exit}')"
ACTIVE_METRIC="$(default_metric "$ACTIVE_IF")"

# Ethernet
ETH_EXISTS="$(bool_interface_exists eth0)"
ETH_UP="$(bool_interface_up eth0)"
ETH_CARRIER="$(cat /sys/class/net/eth0/carrier 2>/dev/null)"
[ "$ETH_CARRIER" = "1" ] && ETH_LINK=true || ETH_LINK=false
ETH_OPERSTATE="$(cat /sys/class/net/eth0/operstate 2>/dev/null)"
ETH_CIDR="$(ipv4_cidr eth0)"
ETH_IP="$(printf '%s' "$ETH_CIDR" | cut -d/ -f1)"
ETH_PREFIX="$(printf '%s' "$ETH_CIDR" | awk -F/ 'NF>1{print $2}')"
ETH_MAC="$(mac_addr eth0)"
ETH_SPEED="$(cat /sys/class/net/eth0/speed 2>/dev/null)"
ETH_DUPLEX="$(cat /sys/class/net/eth0/duplex 2>/dev/null)"
ETH_GW="$(default_gateway eth0)"
ETH_METRIC="$(default_metric eth0)"

# WiFi AP
AP_EXISTS="$(bool_interface_exists wlan0)"
AP_UP="$(bool_interface_up wlan0)"
AP_MODE="$(iw dev wlan0 info 2>/dev/null | awk '/type / {print $2; exit}')"
AP_SSID="$(awk -F= '/^ssid=/ {print substr($0,index($0,"=")+1); exit}' "$HOSTAPD_CONF" 2>/dev/null)"
AP_CHANNEL="$(iw dev wlan0 info 2>/dev/null | awk '/channel / {print $2; exit}')"
AP_FREQ="$(iw dev wlan0 info 2>/dev/null | awk '/channel / {gsub(/[()]/,"",$3); print $3; exit}')"
AP_IP="$(ipv4_only bridge0)"
AP_MAC="$(mac_addr wlan0)"
AP_WPA="$(awk -F= '/^wpa=/ {print $2; exit}' "$HOSTAPD_CONF" 2>/dev/null)"
AP_KEY_MGMT="$(awk -F= '/^wpa_key_mgmt=/ {print $2; exit}' "$HOSTAPD_CONF" 2>/dev/null)"
case "$AP_WPA" in
    2) AP_SECURITY="WPA2-PSK" ;;
    3) AP_SECURITY="WPA/WPA2" ;;
    1) AP_SECURITY="WPA-PSK" ;;
    *) [ -n "$AP_KEY_MGMT" ] && AP_SECURITY="$AP_KEY_MGMT" || AP_SECURITY="Abierta/No detectada" ;;
esac

# Algunos drivers Qualcomm no exponen los clientes AP mediante
# `iw station dump`, aunque estén asociados. Se combinan varias fuentes
# y se deduplican por MAC para obtener un inventario más robusto.
STATIONS_RAW="/tmp/hoit_wifi_stations_raw.$$"
STATIONS_TMP="/tmp/hoit_wifi_stations.$$"
: > "$STATIONS_RAW"

# Fuente 1: nl80211 / iw.
iw dev wlan0 station dump 2>/dev/null | awk '
function emit(){if(mac!="") print mac "|" signal "|" rx "|" tx}
/^Station / {emit(); mac=$2; signal=""; rx=""; tx=""; next}
$1=="signal:" {signal=$2; next}
$1=="rx" && $2=="bytes:" {rx=$3; next}
$1=="tx" && $2=="bytes:" {tx=$3; next}
END {emit()}
' >> "$STATIONS_RAW"

# Fuente 2: tabla interna de hostapd, cuando hostapd_cli/control socket
# están disponibles en el firmware.
if command -v hostapd_cli >/dev/null 2>&1; then
    HOSTAPD_STA_TMP="/tmp/hoit_hostapd_stations.$$"
    : > "$HOSTAPD_STA_TMP"

    for CTRL in "" /var/run/hostapd /data/hostapd /tmp/hostapd; do
        if [ -n "$CTRL" ]; then
            hostapd_cli -p "$CTRL" -i wlan0 all_sta > "$HOSTAPD_STA_TMP" 2>/dev/null
        else
            hostapd_cli -i wlan0 all_sta > "$HOSTAPD_STA_TMP" 2>/dev/null
        fi

        grep -qE '^[0-9A-Fa-f][0-9A-Fa-f]:' "$HOSTAPD_STA_TMP" 2>/dev/null && break
    done

    awk '
    function emit(){if(mac!="") print mac "|" signal "|" rx "|" tx}
    /^[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]$/ {
        emit(); mac=$1; signal=""; rx=""; tx=""; next
    }
    /^signal=/ {split($0,a,"="); signal=a[2]; next}
    /^rx_bytes=/ {split($0,a,"="); rx=a[2]; next}
    /^tx_bytes=/ {split($0,a,"="); tx=a[2]; next}
    END {emit()}
    ' "$HOSTAPD_STA_TMP" >> "$STATIONS_RAW"

    rm -f "$HOSTAPD_STA_TMP"
fi

# Fuente 3: vecinos IPv4 observados en el bridge del AP.
ip neigh show dev bridge0 2>/dev/null | awk '
{
    ip=$1; mac=""; state=$NF
    for(i=1;i<=NF;i++) if($i=="lladdr") mac=$(i+1)
    if(mac!="" && state!="FAILED" && state!="INCOMPLETE")
        print mac "||||" ip
}
' >> "$STATIONS_RAW"

# Fuente 4: caché ARP. Solo entradas completas del bridge/AP.
awk '
NR>1 && ($6=="bridge0" || $6=="wlan0") && $3=="0x2" && $4!="00:00:00:00:00:00" {
    print $4 "||||" $1
}
' /proc/net/arp 2>/dev/null >> "$STATIONS_RAW"

AP_BRIDGE_MAC="$(mac_addr bridge0)"

# Deduplicar por MAC y conservar el primer dato no vacío de cada fuente.
awk -F'|' -v apmac="$AP_MAC" -v brmac="$AP_BRIDGE_MAC" '
function valid(m) {
    return m ~ /^[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]$/
}
{
    m=tolower($1)
    if(!valid(m) || m==tolower(apmac) || m==tolower(brmac) || m=="00:00:00:00:00:00") next
    if(!(m in seen)) {seen[m]=1; order[++count]=m}
    if(signal[m]=="" && $2!="") signal[m]=$2
    if(rx[m]=="" && $3!="") rx[m]=$3
    if(tx[m]=="" && $4!="") tx[m]=$4
    if(ip[m]=="" && $5!="") ip[m]=$5
}
END {
    for(i=1;i<=count;i++) {
        m=order[i]
        print m "|" signal[m] "|" rx[m] "|" tx[m] "|" ip[m]
    }
}
' "$STATIONS_RAW" > "$STATIONS_TMP"

AP_CLIENTS="$(wc -l < "$STATIONS_TMP" 2>/dev/null | tr -d ' ')"
[ -n "$AP_CLIENTS" ] || AP_CLIENTS=0

# WiFi cliente
CLIENT_EXISTS="$(bool_interface_exists wlan1)"
CLIENT_UP="$(bool_interface_up wlan1)"
WPA_STATUS="$(wpa_cli -p "$WPA_CTRL" -i wlan1 status 2>/dev/null)"
CLIENT_STATE="$(printf '%s\n' "$WPA_STATUS" | awk -F= '/^wpa_state=/ {print $2; exit}')"
CLIENT_SSID="$(printf '%s\n' "$WPA_STATUS" | awk -F= '/^ssid=/ {print substr($0,index($0,"=")+1); exit}')"
CLIENT_BSSID="$(printf '%s\n' "$WPA_STATUS" | awk -F= '/^bssid=/ {print $2; exit}')"
CLIENT_CIDR="$(ipv4_cidr wlan1)"
CLIENT_IP="$(printf '%s' "$CLIENT_CIDR" | cut -d/ -f1)"
CLIENT_PREFIX="$(printf '%s' "$CLIENT_CIDR" | awk -F/ 'NF>1{print $2}')"
CLIENT_GW="$(cat /data/hoit/state/wlan1.gateway 2>/dev/null | awk '{print $1; exit}')"
[ -n "$CLIENT_GW" ] || CLIENT_GW="$(default_gateway wlan1)"
CLIENT_METRIC="$(default_metric wlan1)"
CLIENT_LINK="$(iw dev wlan1 link 2>/dev/null)"
CLIENT_SIGNAL="$(printf '%s\n' "$CLIENT_LINK" | awk '/signal:/ {print $2; exit}')"
CLIENT_FREQ="$(printf '%s\n' "$CLIENT_LINK" | awk '/freq:/ {print $2; exit}')"
CLIENT_BITRATE="$(printf '%s\n' "$CLIENT_LINK" | awk '/tx bitrate:/ {print $3 " " $4; exit}')"
[ "$CLIENT_STATE" = "COMPLETED" ] && CLIENT_CONNECTED=true || CLIENT_CONNECTED=false

if [ "$AP_EXISTS" = true ] && [ "$CLIENT_EXISTS" = true ]; then
    WIFI_MODE="AP + Cliente"
elif [ "$AP_EXISTS" = true ]; then
    WIFI_MODE="Access Point"
elif [ "$CLIENT_EXISTS" = true ]; then
    WIFI_MODE="Cliente"
else
    WIFI_MODE="Desactivado"
fi

# LTE y servicios
LTE_EXISTS="$(bool_interface_exists rmnet_data0)"
LTE_UP="$(bool_interface_up rmnet_data0)"
LTE_CIDR="$(ipv4_cidr rmnet_data0)"
LTE_IP="$(printf '%s' "$LTE_CIDR" | cut -d/ -f1)"
LTE_GW="$(default_gateway rmnet_data0)"
LTE_METRIC="$(default_metric rmnet_data0)"

# Configuración LTE guardada. Nunca se devuelve APN_PASSWORD al navegador.
LTE_CFG_APN=""
LTE_CFG_PROFILE=""
LTE_CFG_PDP="IP"
LTE_CFG_AUTH="0"
LTE_CFG_USER=""
LTE_CFG_PASSWORD_SET=false
if [ -r "$LTE_CONF" ]; then
    LTE_CONFIG_VALUES="$(
        unset APN PROFILE_ID PDP_TYPE APN_AUTH APN_USER APN_PASSWORD
        . "$LTE_CONF" 2>/dev/null
        printf '%s\n' "${APN:-}" "${PROFILE_ID:-}" "${PDP_TYPE:-IP}" "${APN_AUTH:-0}" "${APN_USER:-}" "${APN_PASSWORD:-}"
    )"
    LTE_CFG_APN="$(printf '%s\n' "$LTE_CONFIG_VALUES" | sed -n '1p')"
    LTE_CFG_PROFILE="$(printf '%s\n' "$LTE_CONFIG_VALUES" | sed -n '2p')"
    LTE_CFG_PDP="$(printf '%s\n' "$LTE_CONFIG_VALUES" | sed -n '3p')"
    LTE_CFG_AUTH="$(printf '%s\n' "$LTE_CONFIG_VALUES" | sed -n '4p')"
    LTE_CFG_USER="$(printf '%s\n' "$LTE_CONFIG_VALUES" | sed -n '5p')"
    LTE_CFG_PASSWORD="$(printf '%s\n' "$LTE_CONFIG_VALUES" | sed -n '6p')"
    [ -n "$LTE_CFG_PASSWORD" ] && LTE_CFG_PASSWORD_SET=true
fi
[ -n "$LTE_CFG_APN" ] || LTE_CFG_APN="$(printf '%s' "$GATEWAY_JSON" | sed -n 's/.*"apn"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
[ -n "$LTE_CFG_PROFILE" ] || LTE_CFG_PROFILE="6"

HOIT_WIFI_STATE="$(init_service_state hoit_wifi)"
HOIT_CONN_STATE="$(init_service_state hoit_conn)"
HOSTAPD_STATE="$(process_state '[h]ostapd')"
DNSMASQ_STATE="$(process_state '[d]nsmasq')"
WPA_STATE_PROCESS="$(process_state '[w]pa_supplicant.*wlan1')"

# Rutas por defecto como arreglo JSON
ROUTES_TMP="/tmp/hoit_default_routes.$$"
ip route show default 2>/dev/null > "$ROUTES_TMP"
ROUTES_JSON=""
ROUTE_FIRST=1
while IFS= read -r LINE; do
    [ -n "$LINE" ] || continue
    R_IF="$(printf '%s\n' "$LINE" | awk '{for(i=1;i<=NF;i++) if($i=="dev") {print $(i+1); exit}}')"
    R_GW="$(printf '%s\n' "$LINE" | awk '{for(i=1;i<=NF;i++) if($i=="via") {print $(i+1); exit}}')"
    R_METRIC="$(printf '%s\n' "$LINE" | awk '{for(i=1;i<=NF;i++) if($i=="metric") {print $(i+1); exit}}')"
    [ -n "$R_METRIC" ] || R_METRIC=0
    [ "$R_IF" = "$ACTIVE_IF" ] && R_ACTIVE=true || R_ACTIVE=false
    [ "$ROUTE_FIRST" = 1 ] || ROUTES_JSON="$ROUTES_JSON,"
    ROUTES_JSON="$ROUTES_JSON{\"interface\":\"$(json_escape "$R_IF")\",\"gateway\":\"$(json_escape "$R_GW")\",\"metric\":$R_METRIC,\"active\":$R_ACTIVE}"
    ROUTE_FIRST=0
done < "$ROUTES_TMP"

# Clientes conectados al AP como arreglo JSON
CLIENTS_JSON=""
CLIENT_FIRST=1
while IFS='|' read -r C_MAC C_SIGNAL C_RX C_TX C_DISCOVERED_IP; do
    [ -n "$C_MAC" ] || continue
    C_IP="$(lease_value "$C_MAC" 3)"
    C_NAME="$(lease_value "$C_MAC" 4)"
    [ -n "$C_IP" ] || C_IP="$C_DISCOVERED_IP"
    if [ -z "$C_IP" ]; then
        C_IP="$(ip neigh show dev bridge0 2>/dev/null | awk -v mac="$C_MAC" '{for(i=1;i<=NF;i++) if($i=="lladdr" && tolower($(i+1))==tolower(mac)){print $1; exit}}')"
    fi
    [ "$C_NAME" = "*" ] && C_NAME=""
    [ "$CLIENT_FIRST" = 1 ] || CLIENTS_JSON="$CLIENTS_JSON,"
    CLIENTS_JSON="$CLIENTS_JSON{\"mac\":\"$(json_escape "$C_MAC")\",\"ip\":\"$(json_escape "$C_IP")\",\"hostname\":\"$(json_escape "$C_NAME")\",\"signal_dbm\":\"$(json_escape "$C_SIGNAL")\",\"rx_bytes\":\"$(json_escape "$C_RX")\",\"tx_bytes\":\"$(json_escape "$C_TX")\"}"
    CLIENT_FIRST=0
done < "$STATIONS_TMP"

rm -f "$STATIONS_RAW" "$STATIONS_TMP" "$ROUTES_TMP"

cat <<JSON
{
  "ok": true,
  "generated_at": "$(json_escape "$GENERATED_AT")",
  "active": {
    "interface": "$(json_escape "$ACTIVE_IF")",
    "gateway": "$(json_escape "$ACTIVE_GW")",
    "source_ip": "$(json_escape "$ACTIVE_SRC")",
    "metric": "$(json_escape "$ACTIVE_METRIC")"
  },
  "dns": "$(json_escape "$DNS_LIST")",
  "routes": [$ROUTES_JSON],
  "ethernet": {
    "interface": "eth0",
    "exists": $ETH_EXISTS,
    "up": $ETH_UP,
    "link": $ETH_LINK,
    "operstate": "$(json_escape "$ETH_OPERSTATE")",
    "cidr": "$(json_escape "$ETH_CIDR")",
    "ip": "$(json_escape "$ETH_IP")",
    "prefix": "$(json_escape "$ETH_PREFIX")",
    "gateway": "$(json_escape "$ETH_GW")",
    "metric": "$(json_escape "$ETH_METRIC")",
    "mac": "$(json_escape "$ETH_MAC")",
    "speed_mbps": "$(json_escape "$ETH_SPEED")",
    "duplex": "$(json_escape "$ETH_DUPLEX")"
  },
  "wifi": {
    "mode": "$(json_escape "$WIFI_MODE")",
    "services": {
      "hoit_wifi": "$(json_escape "$HOIT_WIFI_STATE")",
      "hostapd": "$(json_escape "$HOSTAPD_STATE")",
      "dnsmasq": "$(json_escape "$DNSMASQ_STATE")",
      "wpa_supplicant": "$(json_escape "$WPA_STATE_PROCESS")"
    },
    "ap": {
      "interface": "wlan0",
      "exists": $AP_EXISTS,
      "up": $AP_UP,
      "mode": "$(json_escape "$AP_MODE")",
      "ssid": "$(json_escape "$AP_SSID")",
      "ip": "$(json_escape "$AP_IP")",
      "mac": "$(json_escape "$AP_MAC")",
      "channel": "$(json_escape "$AP_CHANNEL")",
      "frequency_mhz": "$(json_escape "$AP_FREQ")",
      "security": "$(json_escape "$AP_SECURITY")",
      "clients": $AP_CLIENTS
    },
    "client": {
      "interface": "wlan1",
      "exists": $CLIENT_EXISTS,
      "up": $CLIENT_UP,
      "connected": $CLIENT_CONNECTED,
      "state": "$(json_escape "$CLIENT_STATE")",
      "ssid": "$(json_escape "$CLIENT_SSID")",
      "bssid": "$(json_escape "$CLIENT_BSSID")",
      "cidr": "$(json_escape "$CLIENT_CIDR")",
      "ip": "$(json_escape "$CLIENT_IP")",
      "prefix": "$(json_escape "$CLIENT_PREFIX")",
      "gateway": "$(json_escape "$CLIENT_GW")",
      "metric": "$(json_escape "$CLIENT_METRIC")",
      "signal_dbm": "$(json_escape "$CLIENT_SIGNAL")",
      "frequency_mhz": "$(json_escape "$CLIENT_FREQ")",
      "tx_bitrate": "$(json_escape "$CLIENT_BITRATE")",
      "active": $([ "$ACTIVE_IF" = "wlan1" ] && printf true || printf false)
    },
    "clients": [$CLIENTS_JSON],
    "manager": $WIFI_STATUS_JSON
  },
  "lte": {
    "interface": "rmnet_data0",
    "exists": $LTE_EXISTS,
    "up": $LTE_UP,
    "cidr": "$(json_escape "$LTE_CIDR")",
    "ip": "$(json_escape "$LTE_IP")",
    "gateway": "$(json_escape "$LTE_GW")",
    "metric": "$(json_escape "$LTE_METRIC")",
    "active": $([ "$ACTIVE_IF" = "rmnet_data0" ] && printf true || printf false),
    "service": "$(json_escape "$HOIT_CONN_STATE")",
    "configuration": {
      "apn": "$(json_escape "$LTE_CFG_APN")",
      "profile_id": "$(json_escape "$LTE_CFG_PROFILE")",
      "pdp_type": "$(json_escape "$LTE_CFG_PDP")",
      "auth_type": "$(json_escape "$LTE_CFG_AUTH")",
      "username": "$(json_escape "$LTE_CFG_USER")",
      "password_configured": $LTE_CFG_PASSWORD_SET
    }
  },
  "gateway": $GATEWAY_JSON
}
JSON
