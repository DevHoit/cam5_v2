#!/bin/sh
# recon_sim7600.sh — reconocimiento del SIM7600SA-H (OpenLinux) antes de instalar
# el gateway C. Solo lee: no modifica nada en el módulo.
#
#   adb push recon_sim7600.sh /tmp/ && adb shell sh /tmp/recon_sim7600.sh [IP_CAM5]
#
# Guarda la salida completa: con ella se elige el toolchain, dónde instalar y
# qué falta (certificados, hora, Ethernet hacia el CAM-5).

CAM5_IP="${1:-192.168.1.101}"
API_HOST="core.hoitlive.com"

sec() { echo; echo "--- $1 ---"; }
have() { command -v "$1" >/dev/null 2>&1 && echo "sí ($(command -v "$1"))" || echo "no"; }

echo "RECONOCIMIENTO SIM7600 · $(date -u 2>/dev/null)"

sec "1. Sistema"
uname -a
for f in /etc/os-release /etc/version /etc/issue /etc/build.prop /etc/sim_version; do
    [ -r "$f" ] && { echo "[$f]"; head -6 "$f"; }
done
grep -m3 -E "model name|Processor|Hardware" /proc/cpuinfo 2>/dev/null

sec "2. libc (define cómo compilar)"
ls -l /lib/libc.so* /lib/ld-linux* /lib/ld-musl* 2>/dev/null
[ -x /lib/libc.so.6 ] && /lib/libc.so.6 2>/dev/null | head -1

sec "3. OpenSSL disponible para enlazar"
ls -l /usr/lib/libssl.so* /usr/lib/libcrypto.so* /lib/libssl.so* /lib/libcrypto.so* 2>/dev/null || echo "no hay libssl: compilar OpenSSL estático"
printf "openssl CLI: "; have openssl
command -v openssl >/dev/null 2>&1 && openssl version

sec "4. Certificados raíz"
for f in /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt /etc/ssl/cert.pem; do
    [ -r "$f" ] && echo "encontrado: $f ($(grep -c 'BEGIN CERTIFICATE' "$f") certificados)"
done
echo "(si no aparece ninguno, copiar ca-certificates.crt y definir CAM5_CA_FILE)"

sec "5. Memoria y almacenamiento persistente"
head -3 /proc/meminfo
df -h 2>/dev/null
echo "[montajes UBI/persistentes]"
mount | grep -E "ubi|/data|/usrdata|/cache" 2>/dev/null
for d in /data /usrdata /cache; do
    [ -d "$d" ] && { touch "$d/.cam5_probe" 2>/dev/null && echo "$d escribible" && rm -f "$d/.cam5_probe" || echo "$d solo lectura"; }
done

sec "6. Red hacia el CAM-5 (Ethernet)"
ip addr 2>/dev/null | grep -E "^[0-9]+:|inet " || ifconfig -a 2>/dev/null | grep -E "^[a-z]|inet "
echo "[rutas]"
ip route 2>/dev/null || route -n 2>/dev/null
echo "[CAM-5 en $CAM5_IP]"
ping -c 2 -W 2 "$CAM5_IP" 2>&1 | tail -2

sec "7. Salida a internet (4G) y DNS"
cat /etc/resolv.conf 2>/dev/null
ping -c 1 -W 3 "$API_HOST" 2>&1 | head -2
if command -v openssl >/dev/null 2>&1; then
    echo | openssl s_client -connect "$API_HOST:443" -servername "$API_HOST" 2>/dev/null | grep -E "Verify return code|subject=|issuer=" | head -3
fi

sec "8. Hora (el portal rechaza lotes con más de 5 min de adelanto)"
date -u
printf "ntpd: "; have ntpd
printf "ntpdate: "; have ntpdate
ps 2>/dev/null | grep -iE "ntp|time_daemon|chrony" | grep -v grep

sec "9. Arranque de servicios"
[ -d /run/systemd/system ] && echo "systemd" || echo "sin systemd"
ls /etc/init.d 2>/dev/null | head -30
ls -d /etc/rc*.d 2>/dev/null
printf "update-rc.d: "; have update-rc.d

sec "10. Herramientas"
for t in gcc make adb nc busybox python3; do printf "%-8s " "$t"; have "$t"; done
echo
echo "Fin del reconocimiento."
