#!/bin/sh
. /data/hoit/lib/portal_auth.sh || exit 1
pa_require_session

CONF="/data/hoit/config/hoit_time.conf"
RUNTIME="/cache/hoit/time_status.json"
DAEMON="/data/hoit/bin/hoit_timed"

cfg()
{
    KEY="$1"
    DEFAULT="$2"
    VALUE="$(
      awk -F= -v key="$KEY" '
        /^[[:space:]]*#/ || /^[[:space:]]*$/ {next}
        $1==key {
          print substr($0,index($0,"=")+1)
          exit
        }
      ' "$CONF" 2>/dev/null
    )"

    [ -n "$VALUE" ] || VALUE="$DEFAULT"
    printf '%s' "$VALUE"
}

# Siempre se regenera: el archivo podía tener la hora de la última sincronización (hasta 1 h
# atrás) y el reloj del portal retrocedía en cada actualización.
if [ -x "$DAEMON" ]; then
    "$DAEMON" --status >/dev/null 2>&1 || true
fi

STATUS='{"schema":"hoit.time.v1","system_epoch":0,"utc_iso":"","local_iso":"","utc_offset_minutes":0,"utc_label":"UTC+00:00","mode":"unknown","source":"none","synchronized":false,"last_sync_epoch":0,"last_attempt_epoch":0,"next_sync_epoch":0,"result":"unavailable","server":""}'

if [ -s "$RUNTIME" ]; then
    FIRST="$(tr -d ' \t\r\n' < "$RUNTIME" 2>/dev/null | cut -c1)"
    [ "$FIRST" = "{" ] && STATUS="$(cat "$RUNTIME")"
fi

RUNNING=false
if [ -x /etc/init.d/hoit_time ] &&
   /etc/init.d/hoit_time status >/dev/null 2>&1; then
    RUNNING=true
fi

MODE="$(cfg MODE ntp)"
OFFSET="$(cfg UTC_OFFSET_MINUTES 0)"
SERVERS="$(cfg NTP_SERVERS pool.ntp.org)"
INTERVAL="$(cfg SYNC_INTERVAL_SEC 21600)"
RETRY="$(cfg RETRY_INTERVAL_SEC 60)"
TIMEOUT="$(cfg NTP_TIMEOUT_SEC 8)"
DEVICE="$(cfg CELLULAR_DEVICE /dev/smd8)"
FALLBACK="$(cfg CELLULAR_FALLBACK 0)"
ZONE="$(cfg TIMEZONE fixed)"
case "$ZONE" in America/Santiago|America/Punta_Arenas) ;; *) ZONE=fixed ;; esac

# Con zona horaria, el desfase vigente (con horario de verano) lo calcula hoit_timed.
if [ "$ZONE" != "fixed" ] && [ -s "$RUNTIME" ]; then
    LIVE="$(sed -n 's/.*"utc_offset_minutes":\(-\{0,1\}[0-9]\{1,4\}\).*/\1/p' "$RUNTIME" | head -n 1)"
    [ -n "$LIVE" ] && OFFSET="$LIVE"
fi

case "$OFFSET" in ''|*[!0-9-]*) OFFSET=0 ;; esac
case "$INTERVAL" in ''|*[!0-9]*) INTERVAL=21600 ;; esac
case "$RETRY" in ''|*[!0-9]*) RETRY=60 ;; esac
case "$TIMEOUT" in ''|*[!0-9]*) TIMEOUT=8 ;; esac
[ "$FALLBACK" = 1 ] || FALLBACK=0

pa_json_headers
echo ""
printf '{'
printf '"ok":true,"version":"1.0","service_running":%s,' "$RUNNING"
printf '"config":{"mode":"%s","timezone":"%s","utc_offset_minutes":%s,"ntp_servers":"%s",' \
  "$(pa_json_escape "$MODE")" "$ZONE" "$OFFSET" "$(pa_json_escape "$SERVERS")"
printf '"sync_interval_sec":%s,"retry_interval_sec":%s,"ntp_timeout_sec":%s,' \
  "$INTERVAL" "$RETRY" "$TIMEOUT"
printf '"cellular_device":"%s","cellular_fallback":%s},' \
  "$(pa_json_escape "$DEVICE")" \
  "$([ "$FALLBACK" = 1 ] && echo true || echo false)"
printf '"status":%s' "$STATUS"
printf '}\n'
