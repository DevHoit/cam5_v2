#!/bin/sh
# HOIT Health Manager v1.0.1
# POSIX/BusyBox compatible.

VERSION="1.0.1"

CONF="/data/hoit/config/hoit_health.conf"
STATE_DIR="/data/hoit/state/health"
RUNTIME_DIR="/cache/hoit/health"
STATUS_FILE="/cache/hoit/health_status.json"
LOCK_DIR="/cache/hoit/health.lock"
DAEMON_LOG="/data/hoit/logs/hoit_health.log"
EVENT_LOG="/data/hoit/logs/hoit_health_events.log"

load_config()
{
    HEALTH_INTERVAL=30
    AUTO_RECOVERY=1
    FAILURES_BEFORE_RESTART=2
    RESTART_COOLDOWN_SEC=120
    MAX_RESTARTS_PER_HOUR=3

    DATA_WARN_PERCENT=75
    DATA_CRIT_PERCENT=90
    CACHE_WARN_PERCENT=75
    CACHE_CRIT_PERCENT=90

    LOG_MAX_KB=512
    LOG_ROTATIONS=3

    METEO_MAX_AGE_SEC=900
    MQTT_STATUS_MAX_AGE_SEC=180

    MONITORED_SERVICES="hoit_portal hoit_wifi hoit_conn hoit_meteo hoit_mqtt hoit_socket"
    AUTO_RESTART_SERVICES="hoit_portal hoit_wifi hoit_conn hoit_meteo hoit_mqtt"

    LOG_FILES="/data/hoit/logs/hoit_mqtt.log /data/hoit/logs/hoit_mqtt_commands.log /data/hoit/logs/hoit_socket_manager.log /data/hoit/logs/hoit_socket_1.log /data/hoit/logs/lighttpd-hoit-error.log /cache/hoit/hoit_meteo.log /data/hoit/logs/hoit_health_events.log"

    [ -r "$CONF" ] && . "$CONF"
}

now_epoch()
{
    date +%s 2>/dev/null || echo 0
}

json_escape()
{
    printf '%s' "$1" |
      sed 's/\\/\\\\/g; s/"/\\"/g; s/\r//g; :a;N;$!ba;s/\n/\\n/g'
}

event_log()
{
    LEVEL="$1"
    CODE="$2"
    MESSAGE="$3"
    EPOCH="$(now_epoch)"
    printf '%s|%s|%s|%s\n' "$EPOCH" "$LEVEL" "$CODE" "$MESSAGE" >> "$EVENT_LOG"
}

daemon_log()
{
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null)" "$*" >> "$DAEMON_LOG"
}

is_uint()
{
    case "$1" in
        ''|*[!0-9]*) return 1 ;;
        *) return 0 ;;
    esac
}

in_list()
{
    NEEDLE="$1"
    LIST="$2"
    for ITEM in $LIST; do
        [ "$ITEM" = "$NEEDLE" ] && return 0
    done
    return 1
}

service_state()
{
    SERVICE="$1"

    if [ -x "/etc/init.d/$SERVICE" ]; then
        OUTPUT="$(/etc/init.d/"$SERVICE" status 2>/dev/null || true)"
        printf '%s' "$OUTPUT" | grep -Eqi 'running|started|active' && {
            printf 'running'
            return
        }
    fi

    case "$SERVICE" in
        hoit_portal)
            ps | grep '[l]ighttpd' >/dev/null 2>&1 && printf 'running' || printf 'stopped'
            ;;
        hoit_wifi)
            ps | grep '[h]oit_wifi' >/dev/null 2>&1 && printf 'running' || printf 'stopped'
            ;;
        hoit_conn)
            ps | grep '[h]oit_conn' >/dev/null 2>&1 && printf 'running' || printf 'stopped'
            ;;
        hoit_meteo)
            ps | grep '[h]oit_meteo' >/dev/null 2>&1 && printf 'running' || printf 'stopped'
            ;;
        hoit_mqtt)
            ps | grep '[h]oit_mqttd' >/dev/null 2>&1 && printf 'running' || printf 'stopped'
            ;;
        hoit_socket)
            ps | grep '[h]oit_socket_manager' >/dev/null 2>&1 && printf 'running' || printf 'stopped'
            ;;
        *)
            printf 'unknown'
            ;;
    esac
}

file_epoch()
{
    stat -c '%Y' "$1" 2>/dev/null || echo 0
}

file_age()
{
    FILE="$1"
    NOW="$2"
    MODIFIED="$(file_epoch "$FILE")"
    is_uint "$MODIFIED" || MODIFIED=0
    if [ "$MODIFIED" -le 0 ] || [ "$NOW" -lt "$MODIFIED" ]; then
        echo -1
    else
        echo $((NOW - MODIFIED))
    fi
}

disk_percent()
{
    PATH_NAME="$1"
    VALUE="$(df -kP "$PATH_NAME" 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5; exit}')"
    is_uint "$VALUE" || VALUE=0
    echo "$VALUE"
}

file_size_kb()
{
    FILE="$1"
    [ -f "$FILE" ] || {
        echo 0
        return
    }
    VALUE="$(du -k "$FILE" 2>/dev/null | awk 'NR==1 {print $1; exit}')"
    is_uint "$VALUE" || VALUE=0
    echo "$VALUE"
}

read_counter()
{
    FILE="$1"
    VALUE="$(cat "$FILE" 2>/dev/null)"
    is_uint "$VALUE" || VALUE=0
    echo "$VALUE"
}

write_counter()
{
    FILE="$1"
    VALUE="$2"
    printf '%s\n' "$VALUE" > "$FILE.tmp.$$"
    chmod 600 "$FILE.tmp.$$" 2>/dev/null || true
    mv "$FILE.tmp.$$" "$FILE"
}

increment_counter()
{
    FILE="$1"
    VALUE="$(read_counter "$FILE")"
    VALUE=$((VALUE + 1))
    write_counter "$FILE" "$VALUE"
    echo "$VALUE"
}

rotate_file()
{
    FILE="$1"
    [ -f "$FILE" ] || return 0

    SIZE="$(file_size_kb "$FILE")"
    [ "$SIZE" -ge "$LOG_MAX_KB" ] || return 0

    INDEX="$LOG_ROTATIONS"
    while [ "$INDEX" -gt 1 ]; do
        PREV=$((INDEX - 1))
        [ -f "$FILE.$PREV" ] && mv -f "$FILE.$PREV" "$FILE.$INDEX"
        INDEX=$PREV
    done

    [ -f "$FILE.1" ] && rm -f "$FILE.1"
    cp "$FILE" "$FILE.1" 2>/dev/null || return 1
    : > "$FILE"

    ROTATED_THIS_RUN=$((ROTATED_THIS_RUN + 1))
    increment_counter "$STATE_DIR/rotations_total" >/dev/null
    write_counter "$STATE_DIR/last_rotation_epoch" "$(now_epoch)"
    event_log "info" "log_rotated" "$FILE (${SIZE} KB)"
    return 0
}

rotate_logs()
{
    ROTATED_THIS_RUN=0
    for FILE in $LOG_FILES; do
        rotate_file "$FILE" || true
    done

    # El propio log del daemon se rota al final para evitar perder la línea en curso.
    if [ -f "$DAEMON_LOG" ]; then
        SIZE="$(file_size_kb "$DAEMON_LOG")"
        if [ "$SIZE" -ge "$LOG_MAX_KB" ]; then
            INDEX="$LOG_ROTATIONS"
            while [ "$INDEX" -gt 1 ]; do
                PREV=$((INDEX - 1))
                [ -f "$DAEMON_LOG.$PREV" ] && mv -f "$DAEMON_LOG.$PREV" "$DAEMON_LOG.$INDEX"
                INDEX=$PREV
            done
            [ -f "$DAEMON_LOG.1" ] && rm -f "$DAEMON_LOG.1"
            cp "$DAEMON_LOG" "$DAEMON_LOG.1" 2>/dev/null || true
            : > "$DAEMON_LOG"
            ROTATED_THIS_RUN=$((ROTATED_THIS_RUN + 1))
            increment_counter "$STATE_DIR/rotations_total" >/dev/null
            write_counter "$STATE_DIR/last_rotation_epoch" "$(now_epoch)"
        fi
    fi
}

prune_restart_history()
{
    SERVICE="$1"
    NOW="$2"
    FILE="$STATE_DIR/restarts_$SERVICE.log"
    CUTOFF=$((NOW - 3600))

    [ -f "$FILE" ] || {
        : > "$FILE"
        chmod 600 "$FILE" 2>/dev/null || true
        return
    }

    awk -v cutoff="$CUTOFF" '$1 ~ /^[0-9]+$/ && $1 >= cutoff {print $1}' "$FILE" > "$FILE.tmp.$$"
    chmod 600 "$FILE.tmp.$$" 2>/dev/null || true
    mv "$FILE.tmp.$$" "$FILE"
}

restart_count_hour()
{
    SERVICE="$1"
    NOW="$2"
    prune_restart_history "$SERVICE" "$NOW"
    awk 'END {print NR+0}' "$STATE_DIR/restarts_$SERVICE.log" 2>/dev/null
}

record_restart()
{
    SERVICE="$1"
    EPOCH="$2"
    printf '%s\n' "$EPOCH" >> "$STATE_DIR/restarts_$SERVICE.log"
    write_counter "$STATE_DIR/last_restart_$SERVICE" "$EPOCH"
    increment_counter "$STATE_DIR/recoveries_total" >/dev/null
}

check_service()
{
    SERVICE="$1"
    NOW="$2"

    SVC_STATE="$(service_state "$SERVICE")"
    SVC_ACTION="none"
    SVC_RESTARTS="$(restart_count_hour "$SERVICE" "$NOW")"
    SVC_LAST_RESTART="$(read_counter "$STATE_DIR/last_restart_$SERVICE")"
    FAIL_FILE="$RUNTIME_DIR/fail_$SERVICE"

    TOTAL_SERVICES=$((TOTAL_SERVICES + 1))

    if [ "$SVC_STATE" = "running" ]; then
        RUNNING_SERVICES=$((RUNNING_SERVICES + 1))
        write_counter "$FAIL_FILE" 0
        return
    fi

    FAILED_SERVICES=$((FAILED_SERVICES + 1))
    FAILS="$(read_counter "$FAIL_FILE")"
    FAILS=$((FAILS + 1))
    write_counter "$FAIL_FILE" "$FAILS"

    if [ "$AUTO_RECOVERY" != 1 ]; then
        SVC_ACTION="auto_recovery_disabled"
        return
    fi

    in_list "$SERVICE" "$AUTO_RESTART_SERVICES" || {
        SVC_ACTION="observe_only"
        return
    }

    [ "$FAILS" -ge "$FAILURES_BEFORE_RESTART" ] || {
        SVC_ACTION="waiting_confirmation"
        return
    }

    if [ "$SVC_LAST_RESTART" -gt 0 ] &&
       [ $((NOW - SVC_LAST_RESTART)) -lt "$RESTART_COOLDOWN_SEC" ]; then
        SVC_ACTION="cooldown"
        return
    fi

    if [ "$SVC_RESTARTS" -ge "$MAX_RESTARTS_PER_HOUR" ]; then
        SVC_ACTION="restart_limit"
        event_log "critical" "restart_limit" "$SERVICE alcanzó $SVC_RESTARTS reinicios durante la última hora"
        return
    fi

    if [ -x "/etc/init.d/$SERVICE" ]; then
        SVC_ACTION="restart_attempt"
        event_log "warning" "service_restart" "Intentando recuperar $SERVICE"
        /etc/init.d/"$SERVICE" restart >/dev/null 2>&1 || true
        sleep 2
        SVC_STATE="$(service_state "$SERVICE")"
        record_restart "$SERVICE" "$NOW"
        SVC_RESTARTS=$((SVC_RESTARTS + 1))

        if [ "$SVC_STATE" = "running" ]; then
            SVC_ACTION="recovered"
            FAILED_SERVICES=$((FAILED_SERVICES - 1))
            RUNNING_SERVICES=$((RUNNING_SERVICES + 1))
            RECOVERED_THIS_RUN=$((RECOVERED_THIS_RUN + 1))
            write_counter "$FAIL_FILE" 0
            event_log "info" "service_recovered" "$SERVICE recuperado correctamente"
        else
            SVC_ACTION="restart_failed"
            event_log "critical" "service_restart_failed" "$SERVICE no inició después del intento automático"
        fi
    else
        SVC_ACTION="service_script_missing"
    fi
}

write_service_json()
{
    SERVICE="$1"
    FIRST="$2"

    [ "$FIRST" -eq 1 ] || printf ',' >> "$SERVICE_JSON"
    printf '{"name":"%s","state":"%s","action":"%s","restarts_last_hour":%s,"last_restart_epoch":%s}' \
      "$(json_escape "$SERVICE")" \
      "$(json_escape "$SVC_STATE")" \
      "$(json_escape "$SVC_ACTION")" \
      "$SVC_RESTARTS" \
      "$SVC_LAST_RESTART" >> "$SERVICE_JSON"
}

json_value_number()
{
    FILE="$1"
    KEY="$2"
    sed -n "s/.*\"$KEY\"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p" "$FILE" 2>/dev/null | head -1
}

json_value_bool()
{
    FILE="$1"
    KEY="$2"
    sed -n "s/.*\"$KEY\"[[:space:]]*:[[:space:]]*\\(true\\|false\\).*/\\1/p" "$FILE" 2>/dev/null | head -1
}

recent_events_json()
{
    FIRST=1
    [ -r "$EVENT_LOG" ] || return

    tail -n 12 "$EVENT_LOG" 2>/dev/null |
    while IFS='|' read -r EPOCH LEVEL CODE MESSAGE; do
        [ -n "$EPOCH" ] || continue
        [ "$FIRST" -eq 1 ] || printf ','
        FIRST=0
        printf '{"epoch":%s,"level":"%s","code":"%s","message":"%s"}' \
          "$EPOCH" \
          "$(json_escape "$LEVEL")" \
          "$(json_escape "$CODE")" \
          "$(json_escape "$MESSAGE")"
    done
}

run_check()
{
    load_config

    mkdir -p "$STATE_DIR" "$RUNTIME_DIR" /data/hoit/logs /cache/hoit
    chmod 700 "$STATE_DIR" "$RUNTIME_DIR" 2>/dev/null || true

    if ! mkdir "$LOCK_DIR" 2>/dev/null; then
        # El bloqueo solo es válido si su dueño sigue vivo y no es este mismo proceso:
        # tras un corte de energía quedaba huérfano y la revisión no volvía a ejecutarse.
        LOCK_PID="$(cat "$LOCK_DIR/pid" 2>/dev/null)"
        if [ -n "$LOCK_PID" ] && [ "$LOCK_PID" != "$$" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
            return 2
        fi
        rm -rf "$LOCK_DIR"
        mkdir "$LOCK_DIR" 2>/dev/null || return 2
        daemon_log "bloqueo huérfano eliminado (pid ${LOCK_PID:-desconocido})"
    fi
    echo "$$" > "$LOCK_DIR/pid"

    trap 'rm -rf "$LOCK_DIR"' EXIT HUP INT TERM

    NOW="$(now_epoch)"
    TOTAL_SERVICES=0
    RUNNING_SERVICES=0
    FAILED_SERVICES=0
    RECOVERED_THIS_RUN=0

    rotate_logs

    SERVICE_JSON="$RUNTIME_DIR/services.json"
    printf '[' > "$SERVICE_JSON"
    FIRST_SERVICE=1

    for SERVICE in $MONITORED_SERVICES; do
        check_service "$SERVICE" "$NOW"
        write_service_json "$SERVICE" "$FIRST_SERVICE"
        FIRST_SERVICE=0
    done
    printf ']' >> "$SERVICE_JSON"

    DATA_PERCENT="$(disk_percent /data)"
    CACHE_PERCENT="$(disk_percent /cache)"
    ROOT_PERCENT="$(disk_percent /)"

    METEO_FILE="/cache/hoit/meteo_summary.json"
    MQTT_FILE="/cache/hoit/mqtt_status.json"

    METEO_AGE="$(file_age "$METEO_FILE" "$NOW")"
    MQTT_AGE="$(file_age "$MQTT_FILE" "$NOW")"

    METEO_STATE="ok"
    if [ "$METEO_AGE" -lt 0 ]; then
        METEO_STATE="missing"
    elif [ "$METEO_AGE" -gt "$METEO_MAX_AGE_SEC" ]; then
        METEO_STATE="stale"
    fi

    MQTT_STATE="ok"
    MQTT_CONNECTED=false
    MQTT_QUEUE=0
    MQTT_DROPPED=0

    if [ "$MQTT_AGE" -lt 0 ]; then
        MQTT_STATE="missing"
    elif [ "$MQTT_AGE" -gt "$MQTT_STATUS_MAX_AGE_SEC" ]; then
        MQTT_STATE="stale"
    else
        MQTT_CONNECTED="$(json_value_bool "$MQTT_FILE" connected)"
        [ "$MQTT_CONNECTED" = true ] || {
            MQTT_CONNECTED=false
            MQTT_STATE="disconnected"
        }
        MQTT_QUEUE="$(json_value_number "$MQTT_FILE" queued_messages)"
        MQTT_DROPPED="$(json_value_number "$MQTT_FILE" queue_dropped)"
        is_uint "$MQTT_QUEUE" || MQTT_QUEUE=0
        is_uint "$MQTT_DROPPED" || MQTT_DROPPED=0
    fi

    OVERALL="healthy"
    REASON="Servicios y recursos dentro de parámetros"

    if [ "$FAILED_SERVICES" -gt 0 ] ||
       [ "$DATA_PERCENT" -ge "$DATA_CRIT_PERCENT" ] ||
       [ "$CACHE_PERCENT" -ge "$CACHE_CRIT_PERCENT" ]; then
        OVERALL="critical"
        REASON="Existe un servicio detenido o almacenamiento en nivel crítico"
    elif [ "$METEO_STATE" != "ok" ] ||
         [ "$MQTT_STATE" != "ok" ] ||
         [ "$DATA_PERCENT" -ge "$DATA_WARN_PERCENT" ] ||
         [ "$CACHE_PERCENT" -ge "$CACHE_WARN_PERCENT" ] ||
         [ "$MQTT_DROPPED" -gt 0 ]; then
        OVERALL="degraded"
        REASON="Se detectaron advertencias que requieren seguimiento"
    fi

    RECOVERIES_TOTAL="$(read_counter "$STATE_DIR/recoveries_total")"
    ROTATIONS_TOTAL="$(read_counter "$STATE_DIR/rotations_total")"
    LAST_ROTATION="$(read_counter "$STATE_DIR/last_rotation_epoch")"

    STATUS_TMP="$STATUS_FILE.tmp.$$"

    cat > "$STATUS_TMP" <<JSON
{
  "ok": true,
  "daemon_version": "$VERSION",
  "generated_at_epoch": $NOW,
  "overall": "$OVERALL",
  "reason": "$(json_escape "$REASON")",
  "auto_recovery": $([ "$AUTO_RECOVERY" = 1 ] && echo true || echo false),
  "services": {
    "total": $TOTAL_SERVICES,
    "running": $RUNNING_SERVICES,
    "failed": $FAILED_SERVICES,
    "recovered_this_run": $RECOVERED_THIS_RUN,
    "recoveries_total": $RECOVERIES_TOTAL,
    "items": $(cat "$SERVICE_JSON")
  },
  "storage": {
    "root_percent": $ROOT_PERCENT,
    "root_readonly_expected": true,
    "data_percent": $DATA_PERCENT,
    "data_warn_percent": $DATA_WARN_PERCENT,
    "data_critical_percent": $DATA_CRIT_PERCENT,
    "cache_percent": $CACHE_PERCENT,
    "cache_warn_percent": $CACHE_WARN_PERCENT,
    "cache_critical_percent": $CACHE_CRIT_PERCENT
  },
  "telemetry": {
    "meteo_state": "$METEO_STATE",
    "meteo_age_sec": $METEO_AGE,
    "meteo_max_age_sec": $METEO_MAX_AGE_SEC,
    "mqtt_state": "$MQTT_STATE",
    "mqtt_connected": $MQTT_CONNECTED,
    "mqtt_status_age_sec": $MQTT_AGE,
    "mqtt_status_max_age_sec": $MQTT_STATUS_MAX_AGE_SEC,
    "mqtt_queued_messages": $MQTT_QUEUE,
    "mqtt_dropped_messages": $MQTT_DROPPED
  },
  "logs": {
    "max_kb": $LOG_MAX_KB,
    "rotations": $LOG_ROTATIONS,
    "rotated_this_run": $ROTATED_THIS_RUN,
    "rotations_total": $ROTATIONS_TOTAL,
    "last_rotation_epoch": $LAST_ROTATION
  },
  "events": [$(recent_events_json)]
}
JSON

    chmod 644 "$STATUS_TMP" 2>/dev/null || true
    mv "$STATUS_TMP" "$STATUS_FILE"

    daemon_log "check overall=$OVERALL services=$RUNNING_SERVICES/$TOTAL_SERVICES data=${DATA_PERCENT}% cache=${CACHE_PERCENT}% meteo=$METEO_STATE mqtt=$MQTT_STATE"

    rm -rf "$LOCK_DIR"
    trap - EXIT HUP INT TERM
    return 0
}

run_daemon()
{
    daemon_log "HOIT Health Manager v$VERSION iniciado"

    while :; do
        run_check || true
        load_config
        sleep "$HEALTH_INTERVAL"
    done
}

case "${1:-}" in
    --version)
        echo "hoit_healthd $VERSION"
        ;;
    --once)
        run_check
        ;;
    --rotate)
        load_config
        mkdir -p "$STATE_DIR" "$RUNTIME_DIR" /data/hoit/logs
        rotate_logs
        run_check || true
        ;;
    --daemon|'')
        run_daemon
        ;;
    *)
        echo "Uso: $0 [--daemon|--once|--rotate|--version]" >&2
        exit 2
        ;;
esac
