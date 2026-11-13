#!/bin/sh
# HOIT — cortafuegos del gateway SIM7600 (IPv4 e IPv6).
#
#   hoit_firewall.sh apply         aplica las reglas si cambiaron (idempotente; lo llama
#                                  hoit_conn_watchdog.sh cada minuto y el portal al guardar)
#   hoit_firewall.sh status-json   estado para el portal
#
# Política:
#   - 4G (rmnet*): no se acepta ninguna conexión entrante.
#   - Wi-Fi corporativo (wlan1): el gateway solo lo usa como salida a internet. El portal
#     (80) y SSH (22) responden ahí solo si WIFI_ADMIN=1, opcionalmente limitado a algunas IP
#     y con vencimiento (WIFI_ADMIN_UNTIL, epoch; al vencer queda bloqueado).
#   - ADB por red (TCP 5565, sin autenticación) siempre bloqueado: solo USB.
#   - Reenvío: nada pasa desde el Wi-Fi corporativo ni desde el 4G hacia otra red; la red
#     del CAM-5 (eth0) solo es alcanzable desde el hotspot propio (puesta en marcha); los
#     equipos del hotspot no salen a internet por el 4G ni por la red corporativa.
#   - Hotspot (bridge0) y red del CAM-5 (eth0): administración permitida (acceso físico).
#
# Configuración: /data/hoit/config/hoit_security.conf

CONF="${HOIT_SECURITY_CONF:-/data/hoit/config/hoit_security.conf}"
CONN_CONF="/data/hoit/config/hoit_conn.conf"
STATE_DIR="/var/run/hoit_firewall"
LOG_FILE="${HOIT_FIREWALL_LOG:-/cache/hoit/netwatch.log}"
LOCK="/var/lock/hoit_firewall.lock"

WIFI_IF="wlan1"
LAN_IF="bridge0"
CAM_IF="eth0"
[ -f "$CONN_CONF" ] && WIFI_IF="$(sed -n 's/^WIFI_IF="\{0,1\}\([^"]*\)"\{0,1\}.*/\1/p' "$CONN_CONF" | tail -1)"
WIFI_IF="${WIFI_IF:-wlan1}"
for ENV in /cache/cam5-gateway/gateway.env /data/cam5-gateway/gateway.env; do
    [ -r "$ENV" ] || continue
    V="$(sed -n 's/^CAM5_ETH_IFACE=//p' "$ENV" | tr -d '\r' | tail -1)"
    [ -n "$V" ] && CAM_IF="$V"
    break
done

log() {
    mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] firewall: $*" >> "$LOG_FILE"
}

load_conf() {
    WIFI_ADMIN=1
    WIFI_ADMIN_UNTIL=0
    WIFI_ADMIN_ALLOW=""
    # shellcheck disable=SC1090
    [ -f "$CONF" ] && . "$CONF"
    case "$WIFI_ADMIN" in 0|1) ;; *) WIFI_ADMIN=1 ;; esac
    case "$WIFI_ADMIN_UNTIL" in ''|*[!0-9]*) WIFI_ADMIN_UNTIL=0 ;; esac
    # Solo direcciones IPv4 (con /prefijo opcional); lo demás se descarta.
    CLEAN=""
    for IP in $(echo "$WIFI_ADMIN_ALLOW" | tr ',' ' '); do
        echo "$IP" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}(/[0-9]{1,2})?$' && CLEAN="$CLEAN $IP"
    done
    WIFI_ADMIN_ALLOW="${CLEAN# }"
}

write_conf() {
    umask 077
    cat > "$CONF.tmp.$$" <<EOF
# HOIT — seguridad de red (lo administra el portal: Seguridad y acceso)
# WIFI_ADMIN: 1 = portal y SSH responden desde el Wi-Fi corporativo; 0 = solo salida a internet
WIFI_ADMIN="$1"
# Epoch en que vuelve a bloquearse (0 = sin vencimiento)
WIFI_ADMIN_UNTIL="$2"
# IP autorizadas separadas por espacio (vacío = toda la red Wi-Fi)
WIFI_ADMIN_ALLOW="$3"
EOF
    mv -f "$CONF.tmp.$$" "$CONF"
}

# Vencimiento: al pasar la hora límite queda bloqueado y se registra.
expire_if_due() {
    [ "$WIFI_ADMIN" = "1" ] && [ "$WIFI_ADMIN_UNTIL" -gt 0 ] || return 0
    NOW="$(date +%s)"
    # Reloj sin sincronizar (año < 2024): no se toma ninguna decisión por tiempo.
    [ "$NOW" -gt 1704067200 ] || return 0
    [ "$NOW" -ge "$WIFI_ADMIN_UNTIL" ] || return 0
    write_conf 0 0 "$WIFI_ADMIN_ALLOW"
    WIFI_ADMIN=0; WIFI_ADMIN_UNTIL=0
    log "venció el acceso temporal desde el Wi-Fi corporativo; queda bloqueado"
    command -v /data/hoit/bin/hoit_auditctl >/dev/null 2>&1 &&
        /data/hoit/bin/hoit_auditctl emit security warning firewall wifi_admin_expired \
            "Venció el acceso temporal de administración desde el Wi-Fi corporativo" "1" "0" system >/dev/null 2>&1
    return 0
}

# ---------------------------------------------------------------- reglas

# Imprime las reglas deseadas, una por línea: "<familia> <cadena> <argumentos>".
rules() {
    # --- IPv4: entrada
    echo "4 G -i lo -j RETURN"
    echo "4 G -m state --state ESTABLISHED,RELATED -j RETURN"
    echo "4 G -p tcp --dport 5565 -j DROP"
    echo "4 G -i rmnet+ -j DROP"
    echo "4 G -i $WIFI_IF -p udp --sport 67 --dport 68 -j RETURN"
    if [ "$WIFI_ADMIN" = "1" ]; then
        if [ -n "$WIFI_ADMIN_ALLOW" ]; then
            for IP in $WIFI_ADMIN_ALLOW; do
                echo "4 G -i $WIFI_IF -s $IP -p tcp -m multiport --dports 22,80 -j RETURN"
                echo "4 G -i $WIFI_IF -s $IP -p icmp --icmp-type 8 -j RETURN"
            done
        else
            echo "4 G -i $WIFI_IF -p tcp -m multiport --dports 22,80 -j RETURN"
            echo "4 G -i $WIFI_IF -p icmp --icmp-type 8 -j RETURN"
        fi
    fi
    echo "4 G -i $WIFI_IF -j DROP"
    # --- IPv4: reenvío
    echo "4 F -i $WIFI_IF -j DROP"
    echo "4 F -o $WIFI_IF -j DROP"
    echo "4 F -i rmnet+ -j DROP"
    echo "4 F -i $LAN_IF -o rmnet+ -j DROP"
    echo "4 F -i $CAM_IF ! -o $LAN_IF -j DROP"
    echo "4 F -o $CAM_IF ! -i $LAN_IF -j DROP"
    # --- IPv6: entrada (ICMPv6 es indispensable para el descubrimiento de vecinos)
    echo "6 G -i lo -j RETURN"
    echo "6 G -m state --state ESTABLISHED,RELATED -j RETURN"
    echo "6 G -p icmpv6 -j RETURN"
    echo "6 G -p tcp --dport 5565 -j DROP"
    echo "6 G -i rmnet+ -j DROP"
    # La lista de IP autorizadas es IPv4: con lista, IPv6 queda cerrado en el Wi-Fi corporativo.
    if [ "$WIFI_ADMIN" = "1" ] && [ -z "$WIFI_ADMIN_ALLOW" ]; then
        echo "6 G -i $WIFI_IF -p tcp -m multiport --dports 22,80 -j RETURN"
    fi
    echo "6 G -i $WIFI_IF -j DROP"
    # --- IPv6: reenvío
    echo "6 F -i $WIFI_IF -j DROP"
    echo "6 F -o $WIFI_IF -j DROP"
    echo "6 F -i rmnet+ -j DROP"
    echo "6 F -i $LAN_IF -o rmnet+ -j DROP"
    echo "6 F -i $CAM_IF -j DROP"
    echo "6 F -o $CAM_IF -j DROP"
}

ipt() { if [ "$1" = 6 ]; then shift; ip6tables "$@"; else shift; iptables "$@"; fi; }

# Reconstruye una cadena sin dejar un instante sin reglas: se arma una cadena nueva,
# se engancha primero y recién entonces se retira la anterior.
rebuild_chain() {
    FAM="$1"; KEY="$2"; NAME="$3"; HOOK="$4"; SPEC="$5"
    NEW="${NAME}_N"
    ipt "$FAM" -F "$NEW" 2>/dev/null; ipt "$FAM" -X "$NEW" 2>/dev/null
    ipt "$FAM" -N "$NEW" || return 1
    grep "^$FAM $KEY " "$SPEC" | while read -r _ _ ARGS; do
        # shellcheck disable=SC2086
        ipt "$FAM" -A "$NEW" $ARGS || echo "regla rechazada: $ARGS" >> "$STATE_DIR/errors"
    done
    ipt "$FAM" -I "$HOOK" 1 -j "$NEW"
    while ipt "$FAM" -D "$HOOK" -j "$NAME" 2>/dev/null; do :; done
    ipt "$FAM" -F "$NAME" 2>/dev/null; ipt "$FAM" -X "$NAME" 2>/dev/null
    ipt "$FAM" -E "$NEW" "$NAME"
}

chain_ok() {
    FAM="$1"; KEY="$2"; NAME="$3"; HOOK="$4"; SPEC="$5"
    WANT="$(grep -c "^$FAM $KEY " "$SPEC")"
    HAVE="$(ipt "$FAM" -S "$NAME" 2>/dev/null | grep -c '^-A')"
    [ "$WANT" = "$HAVE" ] || return 1
    # El enganche debe ser la primera regla: QCMAP agrega reglas propias al inicio.
    ipt "$FAM" -S "$HOOK" 2>/dev/null | grep '^-A' | head -1 | grep -q -- "-j $NAME\$"
}

apply() {
    command -v iptables >/dev/null 2>&1 || return 0
    mkdir -p "$STATE_DIR"
    load_conf
    expire_if_due
    SPEC="$STATE_DIR/spec.new"
    rules > "$SPEC"
    SIG="$(md5sum "$SPEC" | cut -d' ' -f1)"
    CHANGED=0
    [ "$(cat "$STATE_DIR/sig" 2>/dev/null)" = "$SIG" ] || CHANGED=1
    rm -f "$STATE_DIR/errors"
    for ITEM in "4 G HOIT_GUARD INPUT" "4 F HOIT_FWD FORWARD" "6 G HOIT_GUARD6 INPUT" "6 F HOIT_FWD6 FORWARD"; do
        set -- $ITEM
        [ "$1" = 6 ] && ! command -v ip6tables >/dev/null 2>&1 && continue
        if [ "$CHANGED" = 1 ] || ! chain_ok "$1" "$2" "$3" "$4" "$SPEC"; then
            rebuild_chain "$1" "$2" "$3" "$4" "$SPEC"
            REBUILT=1
        fi
    done
    echo "$SIG" > "$STATE_DIR/sig"
    mv -f "$SPEC" "$STATE_DIR/spec"
    if [ "${REBUILT:-0}" = 1 ]; then
        if [ "$WIFI_ADMIN" = 1 ]; then
            MODE="permitida${WIFI_ADMIN_ALLOW:+ solo desde $WIFI_ADMIN_ALLOW}"
            [ "$WIFI_ADMIN_UNTIL" -gt 0 ] && MODE="$MODE hasta $(date -D %s -d "$WIFI_ADMIN_UNTIL" '+%Y-%m-%d %H:%M' 2>/dev/null || echo "$WIFI_ADMIN_UNTIL")"
        else
            MODE="bloqueada"
        fi
        log "reglas aplicadas (administración desde $WIFI_IF: $MODE)"
        [ -s "$STATE_DIR/errors" ] && log "$(head -3 "$STATE_DIR/errors" | tr '\n' ';')"
    fi
    return 0
}

status_json() {
    load_conf
    NOW="$(date +%s)"
    WIFI_IP="$(ip -4 addr show dev "$WIFI_IF" 2>/dev/null | sed -n 's/.*inet \([0-9.]*\)\/.*/\1/p' | head -1)"
    ACTIVE=false
    iptables -S HOIT_GUARD 2>/dev/null | grep -q -- "-i $WIFI_IF -j DROP" && ACTIVE=true
    printf '{"wifi_admin":%s,"wifi_admin_until":%s,"wifi_admin_allow":"%s","wifi_interface":"%s","wifi_ip":"%s","firewall_active":%s,"now":%s}\n' \
        "$([ "$WIFI_ADMIN" = 1 ] && echo true || echo false)" "$WIFI_ADMIN_UNTIL" "$WIFI_ADMIN_ALLOW" \
        "$WIFI_IF" "$WIFI_IP" "$ACTIVE" "$NOW"
}

case "$1" in
    apply)
        # Un solo aplicador a la vez (vigilante cada minuto y portal al guardar).
        exec 8>"$LOCK"
        flock -x 8
        apply
        ;;
    status-json) status_json ;;
    set)
        # set <0|1> <until_epoch> "<ip ip ...>"  (lo usa el portal)
        mkdir -p "$(dirname "$CONF")"
        write_conf "$2" "$3" "$4"
        exec 8>"$LOCK"
        flock -x 8
        apply
        ;;
    *) echo "Uso: $0 {apply|status-json|set 0|1 UNTIL 'IP ...'}"; exit 1 ;;
esac
