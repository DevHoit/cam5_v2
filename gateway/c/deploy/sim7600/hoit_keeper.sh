#!/bin/sh
# HOIT — supervisor raíz. Lo lanza init desde /etc/inittab con "respawn": si este
# proceso muere, init lo vuelve a crear. Solo vigila a hoit_health (que a su vez
# reinicia cam5-gateway, la vigilancia de red, la hora, el portal y el Wi-Fi) y a
# la vigilancia de red, que es la que reinicia el equipo cuando no hay salida.
#
#   /etc/inittab:  hk:5:respawn:/data/hoit/bin/hoit_keeper.sh

SERVICES="${KEEPER_SERVICES:-hoit_health hoit_conn}"
INTERVAL=60
LOG=/cache/hoit/keeper.log

log() {
    [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 65536 ] && mv -f "$LOG" "$LOG.1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

# Al arrancar el equipo, los scripts de /etc/rc5.d inician los servicios: se espera
# a que terminen para no lanzar instancias duplicadas.
UP="$(cut -d. -f1 /proc/uptime)"
[ "$UP" -lt 240 ] && sleep $((240 - UP))

while :; do
    for SVC in $SERVICES; do
        [ -x "/etc/init.d/$SVC" ] || continue
        /etc/init.d/"$SVC" status 2>/dev/null | grep -Eqi 'running|started|active' && continue
        log "$SVC no está en ejecución: iniciando"
        /etc/init.d/"$SVC" start >/dev/null 2>&1
    done
    sleep "$INTERVAL"
done
