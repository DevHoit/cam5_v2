#!/bin/sh
# Bucle de hoit_conn: ejecuta un ciclo de vigilancia de conectividad cada CHECK_INTERVAL segundos.
# El detalle queda en /cache/hoit/netwatch.log (con rotación); aquí solo se registran arranques,
# paradas y ciclos que terminan con error, para no escribir en /data cada minuto.

trap '' HUP

APP="/data/hoit/bin/hoit_conn_watchdog.sh"
CONF="/data/hoit/config/hoit_conn.conf"
LOG="/data/hoit/logs/hoit_conn_runner.log"
PID_FILE="/data/hoit/state/hoit_conn_runner.pid"

mkdir -p /data/hoit/logs /data/hoit/state /cache/hoit
echo $$ > "$PID_FILE"

cleanup() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] hoit_conn_runner detenido" >> "$LOG"
    rm -f "$PID_FILE"
    exit 0
}
trap cleanup TERM INT

[ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 65536 ] && mv -f "$LOG" "$LOG.1"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] hoit_conn_runner iniciado PID=$$" >> "$LOG"

while true; do
    CHECK_INTERVAL=60
    [ -f "$CONF" ] && . "$CONF"
    OUT="$("$APP" once 2>&1)"
    RC=$?
    [ "$RC" -ne 0 ] && echo "[$(date '+%Y-%m-%d %H:%M:%S')] ciclo rc=$RC $OUT" >> "$LOG"
    sleep "${CHECK_INTERVAL:-60}" &
    wait $!
done
