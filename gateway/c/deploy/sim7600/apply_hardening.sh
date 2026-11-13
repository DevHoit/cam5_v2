#!/bin/sh
# Fase 1 de seguridad y vigilancia del gateway SIM7600 (idempotente: se puede repetir).
#   - cortafuegos IPv4/IPv6 con interruptor de administración desde el Wi-Fi corporativo
#     (portal: Seguridad y acceso), bloqueo de reenvíos hacia la red del CAM-5 y del hotspot al 4G
#   - cam5-gateway con detección de cuelgue (archivo de vida) vigilado por hoit_health
#   - supervisor raíz en /etc/inittab (init lo revive si muere)
#   - hotspot WPA2-CCMP, permisos de archivos sensibles, SSH endurecido, simcom_aliyun apagado
#
# Uso (en el equipo):  sh /cache/cam5-deploy/apply_hardening.sh /cache/cam5-deploy
#   SSH_KEY_ONLY=1 sh ...   además deja SSH solo con llave (exige /root/.ssh/authorized_keys)

SRC="${1:-/cache/cam5-deploy}"
H=/data/hoit
W="$H/www"
say() { echo "[fase1] $*"; }

for F in hoit_firewall.sh hoit_keeper.sh hoit_conn_watchdog.sh cam5-gateway.init \
         portal/security-access.html portal/assets/security-access-v1.js portal/assets/security-access-v1.css \
         portal/cgi-bin/security_network.cgi portal/cgi-bin/security_network_action.cgi; do
    [ -f "$SRC/$F" ] || { echo "Falta $SRC/$F"; exit 1; }
done

mount -o remount,rw / || { echo "No se pudo montar / en escritura"; exit 1; }
trap 'sync; mount -o remount,ro / 2>/dev/null' EXIT

# 1) Cortafuegos ---------------------------------------------------------------------------------
for F in hoit_firewall.sh hoit_keeper.sh hoit_conn_watchdog.sh; do
    cp "$SRC/$F" "$H/bin/$F.new" && chmod 755 "$H/bin/$F.new" && mv -f "$H/bin/$F.new" "$H/bin/$F"
done
SEC="$H/config/hoit_security.conf"
# Por omisión se mantiene el acceso desde el Wi-Fi corporativo (como antes); se cierra desde el portal.
[ -f "$SEC" ] || "$H/bin/hoit_firewall.sh" set 1 0 "" >/dev/null 2>&1
chmod 600 "$SEC" 2>/dev/null
"$H/bin/hoit_firewall.sh" apply
say "Cortafuegos aplicado ($(sed -n 's/^WIFI_ADMIN=//p' "$SEC" | tr -d '"' | sed 's/1/administración por Wi-Fi permitida/;s/0/administración por Wi-Fi bloqueada/'))"

# 2) Portal: Seguridad y acceso ------------------------------------------------------------------
cp "$SRC/portal/security-access.html" "$W/security-access.html"
cp "$SRC/portal/assets/security-access-v1.js" "$SRC/portal/assets/security-access-v1.css" "$W/assets/"
cp "$SRC/portal/cgi-bin/security_network.cgi" "$SRC/portal/cgi-bin/security_network_action.cgi" "$W/cgi-bin/"
chmod 755 "$W/cgi-bin/security_network.cgi" "$W/cgi-bin/security_network_action.cgi"
say "Portal: interruptor en Seguridad y acceso"

# 3) cam5-gateway: binario nuevo (si viene) y script con detección de cuelgue --------------------
GWDIR=/data/cam5-gateway
[ -x /cache/cam5-gateway/cam5-gateway ] && GWDIR=/cache/cam5-gateway
if [ -f "$SRC/cam5-gateway" ]; then
    cp "$SRC/cam5-gateway" "$GWDIR/cam5-gateway.new" && chmod 755 "$GWDIR/cam5-gateway.new" &&
        mv -f "$GWDIR/cam5-gateway.new" "$GWDIR/cam5-gateway"
    say "Binario: $("$GWDIR/cam5-gateway" --version 2>&1 | head -1)"
fi
cp "$SRC/cam5-gateway.init" /etc/init.d/cam5-gateway && chmod 755 /etc/init.d/cam5-gateway

# 4) hoit_health vigila también cam5-gateway -------------------------------------------------------
HC="$H/config/hoit_health.conf"
for KEY in MONITORED_SERVICES AUTO_RESTART_SERVICES; do
    grep -q "^$KEY=.*cam5-gateway" "$HC" || sed -i "s|^$KEY=\"\(.*\)\"|$KEY=\"\1 cam5-gateway\"|" "$HC"
done
say "hoit_health: $(grep '^AUTO_RESTART_SERVICES=' "$HC")"

# 5) Supervisor raíz en inittab --------------------------------------------------------------------
if ! grep -q '^hk:' /etc/inittab; then
    [ -f /etc/inittab.pre_hoit ] || cp -p /etc/inittab /etc/inittab.pre_hoit
    echo 'hk:5:respawn:/data/hoit/bin/hoit_keeper.sh' >> /etc/inittab
    kill -HUP 1
    say "inittab: hoit_keeper con respawn (copia en /etc/inittab.pre_hoit)"
fi

# 6) Servicios innecesarios ------------------------------------------------------------------------
if [ -e /etc/rc5.d/S98simcom_aliyun ]; then
    /etc/init.d/simcom_aliyun stop >/dev/null 2>&1
    PID="$(pidof simcom_aliyun)"; [ -n "$PID" ] && kill -9 $PID 2>/dev/null  # ignora TERM
    update-rc.d -f simcom_aliyun remove >/dev/null 2>&1 || rm -f /etc/rc5.d/S98simcom_aliyun
    say "simcom_aliyun (nube Aliyun de SIMCom) desactivado"
fi

# 7) Permisos de archivos sensibles ----------------------------------------------------------------
chmod 600 /etc/shadow /etc/hostapd.conf 2>/dev/null
chmod 644 /etc/passwd /etc/ssh/sshd_config /etc/ssh/sshd_config_readonly /etc/ssh/ssh_config /etc/ssh/moduli 2>/dev/null

# 8) SSH --------------------------------------------------------------------------------------------
SC=/etc/ssh/sshd_config
CHANGED_SSH=0
set_ssh() {
    if grep -q "^$1 " "$SC"; then
        grep -q "^$1 $2\$" "$SC" && return 0
        sed -i "s|^$1 .*|$1 $2|" "$SC"
    else
        echo "$1 $2" >> "$SC"
    fi
    CHANGED_SSH=1
}
set_ssh MaxAuthTries 3
set_ssh LoginGraceTime 30
set_ssh PermitEmptyPasswords no
if [ "${SSH_KEY_ONLY:-0}" = 1 ]; then
    if [ -s /root/.ssh/authorized_keys ]; then
        chmod 700 /root/.ssh; chmod 600 /root/.ssh/authorized_keys
        set_ssh PasswordAuthentication no
        set_ssh PermitRootLogin without-password
        say "SSH: solo con llave"
    else
        say "SSH: SSH_KEY_ONLY=1 pero no hay /root/.ssh/authorized_keys; se mantiene la contraseña"
    fi
fi
if [ "$CHANGED_SSH" = 1 ]; then
    if sshd -t 2>/dev/null; then
        /etc/init.d/sshd restart >/dev/null 2>&1
        say "SSH endurecido (las sesiones abiertas siguen activas)"
    else
        say "ADVERTENCIA: sshd_config inválido; revisa $SC antes de reiniciar sshd"
    fi
fi

# 9) Hotspot: WPA2-CCMP (misma red y misma clave) ----------------------------------------------------
HA=/etc/hostapd.conf
if [ -f "$HA" ] && { grep -q '^wpa=1$' "$HA" || grep -q 'TKIP' "$HA"; }; then
    cp -p "$HA" "$HA.pre_hoit" 2>/dev/null
    sed -i -e 's/^wpa=.*/wpa=2/' -e '/^wpa_pairwise=/d' -e '/^rsn_pairwise=/d' "$HA"
    echo 'rsn_pairwise=CCMP' >> "$HA"
    chmod 600 "$HA" "$HA.pre_hoit"
    # SIGHUP: hostapd relee la configuración sin que QCMAP lo relance ni cambie el SSID.
    PID="$(pidof hostapd | awk '{print $1}')"
    if [ -n "$PID" ]; then
        kill -HUP "$PID"; sleep 3
        if kill -0 "$PID" 2>/dev/null; then
            say "Hotspot: WPA2-CCMP activo (misma red y clave)"
        else
            cp -p "$HA.pre_hoit" "$HA"
            say "ADVERTENCIA: hostapd se detuvo al recargar; se restauró la configuración anterior (reinicia el equipo)"
        fi
    fi
fi

sync
mount -o remount,ro / 2>/dev/null
trap - EXIT

# 10) Reinicios ---------------------------------------------------------------------------------------
/etc/init.d/cam5-gateway stop >/dev/null 2>&1
setsid /etc/init.d/cam5-gateway start </dev/null >/dev/null 2>&1
/etc/init.d/hoit_health stop >/dev/null 2>&1
setsid /etc/init.d/hoit_health start </dev/null >/dev/null 2>&1
sleep 3
say "cam5-gateway: $(/etc/init.d/cam5-gateway status)"
say "Listo."
