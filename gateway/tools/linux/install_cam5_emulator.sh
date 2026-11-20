#!/bin/sh
# Emula uno o varios CAM-5 en una Raspberry Pi (o cualquier Linux con systemd) como servicios del sistema:
# arrancan solos al encender y se reinician si caen. Cada CAM-5 tiene su propia IP en la red eth0 del
# gateway (192.168.0.0/24) y escucha Modbus TCP en el puerto 502.
#
# Uso:
#   sudo sh install_cam5_emulator.sh agregar NOMBRE IP [INTERFAZ]   (por omisión, eth0)
#   sudo sh install_cam5_emulator.sh quitar NOMBRE
#   sudo sh install_cam5_emulator.sh estado
#
# Ejemplo, dos CAM-5 con un solo cable:
#   sudo sh install_cam5_emulator.sh agregar cam5-1 192.168.0.200
#   sudo sh install_cam5_emulator.sh agregar cam5-2 192.168.0.201
#
# Control de cada equipo (sin reiniciar): /etc/cam5-emulator/NOMBRE.control.json
#   {"offline": true}                   → deja de responder, como un CAM-5 colgado
#   {"overrides": {"419": 812}}         → registro 419 fijo en 812 (81,2 °C en la fase L2)
set -e

ETC=/etc/cam5-emulator
LIB=/usr/local/lib/cam5-emulator
UNIT=/etc/systemd/system/cam5-emulator@.service
SYSCTL=/etc/sysctl.d/90-cam5-emulator.conf
PREFIX=${CAM5_PREFIX:-24}
TEMPS=${CAM5_TEMPERATURES:-9}
HUMIDITY=${CAM5_HUMIDITY:-2}

[ "$(id -u)" = 0 ] || { echo "Ejecútalo con sudo."; exit 1; }
command -v systemctl >/dev/null || { echo "Este instalador necesita systemd (Raspberry Pi OS lo trae)."; exit 1; }
PY=$(command -v python3 || true)
[ -n "$PY" ] || { echo "No encuentro python3: sudo apt install -y python3"; exit 1; }

valid_name() { echo "$1" | grep -Eq '^[a-z0-9][a-z0-9-]{0,30}$'; }
valid_ip() { echo "$1" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; }

install_unit() {
    HERE=$(cd "$(dirname "$0")" && pwd)
    SRC=""
    for CANDIDATE in "$HERE/cam5_modbus_simulator.py" "$HERE/../cam5_modbus_simulator.py"; do
        [ -f "$CANDIDATE" ] && SRC=$CANDIDATE && break
    done
    [ -n "$SRC" ] || { echo "No encuentro cam5_modbus_simulator.py junto a este script."; exit 1; }
    install -d -m 755 "$LIB" "$ETC"
    install -m 644 "$SRC" "$LIB/cam5_modbus_simulator.py"
    # Plantilla: una instancia por CAM-5. La IP se agrega a la interfaz al arrancar (con privilegios, "+")
    # y el simulador corre como usuario sin privilegios, con permiso solo para abrir el puerto 502.
    cat > "$UNIT" <<UNIT
[Unit]
Description=CAM-5 emulado %i (Modbus TCP)
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=$ETC/%i.env
ExecStartPre=+/bin/sh -c 'ip -4 addr show dev "\$IFACE" | grep -q "inet \$HOST/" || ip addr add "\$HOST/\$PREFIX" dev "\$IFACE"'
ExecStart=$PY -I $LIB/cam5_modbus_simulator.py --host \${HOST} --port 502 --name "%i" --temperatures \${TEMPS} --humidity-sensors \${HUMIDITY} --seed \${SEED} --control $ETC/%i.control.json
DynamicUser=yes
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
}

case "$1" in
    agregar)
        NAME=$2; HOST=$3; IFACE=${4:-eth0}
        valid_name "$NAME" || { echo "Nombre inválido (minúsculas, números y guiones, p. ej. cam5-1)."; exit 1; }
        valid_ip "$HOST" || { echo "IP inválida: $HOST"; exit 1; }
        ip link show "$IFACE" >/dev/null 2>&1 || { echo "No existe la interfaz $IFACE. Interfaces: $(ls /sys/class/net | tr '\n' ' ')"; exit 1; }
        for OTHER in "$ETC"/*.env; do
            [ -f "$OTHER" ] || continue
            [ "$(basename "$OTHER" .env)" = "$NAME" ] && continue
            grep -q "^HOST=$HOST$" "$OTHER" && { echo "La IP $HOST ya la usa $(basename "$OTHER" .env)."; exit 1; }
        done
        install_unit
        # Semilla fija por nombre: cada equipo entrega valores distintos y estables entre reinicios.
        SEED=$(printf '%s' "$NAME" | cksum | cut -d' ' -f1)
        printf 'HOST=%s\nIFACE=%s\nPREFIX=%s\nTEMPS=%s\nHUMIDITY=%s\nSEED=%s\n' "$HOST" "$IFACE" "$PREFIX" "$TEMPS" "$HUMIDITY" "$SEED" > "$ETC/$NAME.env"
        [ -f "$ETC/$NAME.control.json" ] || echo '{"offline": false, "overrides": {}}' > "$ETC/$NAME.control.json"
        chmod 644 "$ETC/$NAME.env" "$ETC/$NAME.control.json"
        chown "${SUDO_USER:-root}" "$ETC/$NAME.control.json"
        # Con dos tarjetas en la misma red, cada una debe responder solo por sus propias IP.
        if [ "$(grep -h '^IFACE=' "$ETC"/*.env 2>/dev/null | sort -u | wc -l)" -gt 1 ]; then
            printf 'net.ipv4.conf.all.arp_ignore=1\nnet.ipv4.conf.all.arp_announce=2\n' > "$SYSCTL"
            sysctl -q -p "$SYSCTL"
        fi
        systemctl enable --now "cam5-emulator@$NAME" >/dev/null 2>&1 || systemctl enable --now "cam5-emulator@$NAME"
        systemctl restart "cam5-emulator@$NAME"
        sleep 2
        if ss -ltn | grep -q "$HOST:502"; then
            echo "Listo: $NAME emula un CAM-5 en $HOST:502 ($IFACE)."
        else
            echo "El servicio quedó instalado pero aún no escucha en $HOST:502. Revisa: journalctl -u cam5-emulator@$NAME -n 30"
        fi
        ;;
    quitar)
        NAME=$2
        valid_name "$NAME" || { echo "Indica el nombre, p. ej. cam5-2."; exit 1; }
        if [ -f "$ETC/$NAME.env" ]; then
            . "$ETC/$NAME.env"
            systemctl disable --now "cam5-emulator@$NAME" 2>/dev/null || true
            ip addr del "$HOST/$PREFIX" dev "$IFACE" 2>/dev/null || true
            rm -f "$ETC/$NAME.env"
            echo "Quitado $NAME ($HOST). Se conserva $ETC/$NAME.control.json."
        else
            echo "No existe el emulador $NAME."
        fi
        ;;
    estado)
        found=0
        for ENV in "$ETC"/*.env; do
            [ -f "$ENV" ] || continue
            found=1
            NAME=$(basename "$ENV" .env)
            HOST=$(sed -n 's/^HOST=//p' "$ENV"); IFACE=$(sed -n 's/^IFACE=//p' "$ENV")
            printf '%-12s %-16s %-6s %s\n' "$NAME" "$HOST:502" "$IFACE" "$(systemctl is-active "cam5-emulator@$NAME")"
        done
        [ "$found" = 1 ] || echo "No hay emuladores instalados."
        ;;
    *)
        sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'
        exit 1
        ;;
esac
