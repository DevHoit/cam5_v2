#!/bin/sh
. /data/hoit/lib/portal_auth.sh || exit 1

pa_require_post
pa_require_csrf
pa_read_form

CONF="/data/hoit/config/hoit_time.conf"
INIT="/etc/init.d/hoit_time"
ACTION="$(pa_form_value action)"

is_uint()
{
    case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac
}

is_int()
{
    VALUE="$1"

    case "$VALUE" in
      -*) VALUE="${VALUE#-}" ;;
    esac

    is_uint "$VALUE"
}

valid_server()
{
    VALUE="$1"
    [ -n "$VALUE" ] && [ ${#VALUE} -le 253 ] || return 1
    case "$VALUE" in *[!A-Za-z0-9._:-]*) return 1 ;; esac
}

valid_server_list()
{
    VALUE="$1"
    [ -n "$VALUE" ] && [ ${#VALUE} -le 512 ] || return 1

    OLD_IFS="$IFS"
    IFS=','
    set -- $VALUE
    IFS="$OLD_IFS"

    [ "$#" -ge 1 ] && [ "$#" -le 3 ] || return 1

    for SERVER in "$@"; do
        valid_server "$SERVER" || return 1
    done
}

valid_manual()
{
    VALUE="$1"
    case "$VALUE" in
      [2][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]|[2][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9])
        return 0
        ;;
      *)
        return 1
        ;;
    esac
}

backup_conf()
{
    STAMP="$(date +%Y%m%d_%H%M%S 2>/dev/null || date +%s)"
    BACKUP="/data/hoit/backups/time_settings_$STAMP"
    mkdir -p "$BACKUP"
    [ -f "$CONF" ] && cp -p "$CONF" "$BACKUP/hoit_time.conf"
}

write_conf()
{
    MODE="$1"
    OFFSET="$2"
    SERVERS="$3"
    INTERVAL="$4"
    RETRY="$5"
    TIMEOUT="$6"
    DEVICE="$7"
    FALLBACK="$8"

    cat > "$CONF.tmp.$$" <<EOF
# HOIT Time & NTP Manager v1
MODE=$MODE
UTC_OFFSET_MINUTES=$OFFSET
NTP_SERVERS=$SERVERS
SYNC_INTERVAL_SEC=$INTERVAL
RETRY_INTERVAL_SEC=$RETRY
NTP_TIMEOUT_SEC=$TIMEOUT
CELLULAR_DEVICE=$DEVICE
CELLULAR_FALLBACK=$FALLBACK
EOF

    chmod 600 "$CONF.tmp.$$"
    mv "$CONF.tmp.$$" "$CONF"
}

current_value()
{
    KEY="$1"
    DEFAULT="$2"
    VALUE="$(
      awk -F= -v key="$KEY" '
        $1==key {
          print substr($0,index($0,"=")+1)
          exit
        }
      ' "$CONF" 2>/dev/null
    )"
    [ -n "$VALUE" ] || VALUE="$DEFAULT"
    printf '%s' "$VALUE"
}

respond()
{
    MESSAGE="$1"
    pa_json_headers
    echo ""
    printf '{"ok":true,"message":"%s"}\n' "$(pa_json_escape "$MESSAGE")"
    exit 0
}

[ -x "$INIT" ] || pa_error 503 "El servicio hoit_time no está instalado"

case "$ACTION" in
    save)
        MODE="$(pa_form_value mode)"
        OFFSET="$(pa_form_value utc_offset_minutes)"
        SERVERS="$(pa_form_value ntp_servers)"
        INTERVAL="$(pa_form_value sync_interval_sec)"
        RETRY="$(pa_form_value retry_interval_sec)"
        TIMEOUT="$(pa_form_value ntp_timeout_sec)"
        DEVICE="$(pa_form_value cellular_device)"
        FALLBACK="$(pa_form_value cellular_fallback)"

        case "$MODE" in auto|ntp|cellular|manual) ;; *) pa_error 400 "Modo de hora inválido" ;; esac

        is_int "$OFFSET" || pa_error 400 "UTC inválido"
        [ "$OFFSET" -ge -720 ] && [ "$OFFSET" -le 840 ] || pa_error 400 "UTC fuera de rango"
        [ $((OFFSET % 15)) -eq 0 ] || pa_error 400 "UTC debe avanzar en bloques de 15 minutos"

        valid_server_list "$SERVERS" || pa_error 400 "Lista NTP inválida"

        for VALUE in "$INTERVAL" "$RETRY" "$TIMEOUT"; do
            is_uint "$VALUE" || pa_error 400 "Intervalo inválido"
        done

        [ "$INTERVAL" -ge 300 ] && [ "$INTERVAL" -le 604800 ] || pa_error 400 "Intervalo NTP fuera de rango"
        [ "$RETRY" -ge 30 ] && [ "$RETRY" -le 3600 ] || pa_error 400 "Reintento fuera de rango"
        [ "$TIMEOUT" -ge 1 ] && [ "$TIMEOUT" -le 30 ] || pa_error 400 "Timeout fuera de rango"

        case "$DEVICE" in /dev/smd8|/dev/smd[0-9]|/dev/smd[0-9][0-9]) ;; *) pa_error 400 "Puerto celular inválido" ;; esac
        [ "$FALLBACK" = 1 ] || FALLBACK=0

        backup_conf
        write_conf "$MODE" "$OFFSET" "$SERVERS" "$INTERVAL" "$RETRY" "$TIMEOUT" "$DEVICE" "$FALLBACK"

        "$INIT" restart >/dev/null 2>&1 || pa_error 500 "Configuración guardada, pero hoit_time no reinició"
        respond "Configuración de hora guardada"
        ;;

    manual)
        LOCAL_VALUE="$(pa_form_value local_datetime)"
        OFFSET="$(pa_form_value utc_offset_minutes)"

        valid_manual "$LOCAL_VALUE" || pa_error 400 "Fecha manual inválida"
        is_int "$OFFSET" || pa_error 400 "UTC inválido"
        [ "$OFFSET" -ge -720 ] && [ "$OFFSET" -le 840 ] || pa_error 400 "UTC fuera de rango"
        [ $((OFFSET % 15)) -eq 0 ] || pa_error 400 "UTC debe avanzar en bloques de 15 minutos"

        SERVERS="$(current_value NTP_SERVERS pool.ntp.org)"
        INTERVAL="$(current_value SYNC_INTERVAL_SEC 21600)"
        RETRY="$(current_value RETRY_INTERVAL_SEC 60)"
        TIMEOUT="$(current_value NTP_TIMEOUT_SEC 8)"
        DEVICE="$(current_value CELLULAR_DEVICE /dev/smd8)"
        FALLBACK="$(current_value CELLULAR_FALLBACK 0)"

        backup_conf
        write_conf manual "$OFFSET" "$SERVERS" "$INTERVAL" "$RETRY" "$TIMEOUT" "$DEVICE" "$FALLBACK"

        "$INIT" manual "$LOCAL_VALUE" "$OFFSET" >/dev/null 2>&1 ||
          pa_error 500 "No fue posible ajustar la hora manualmente"

        respond "Hora manual aplicada"
        ;;

    sync)
        MODE="$(current_value MODE ntp)"
        [ "$MODE" != "manual" ] || pa_error 409 "Seleccione NTP, automática o celular antes de sincronizar"

        "$INIT" sync >/dev/null 2>&1 ||
          pa_error 502 "La fuente de tiempo no respondió"

        respond "Sincronización completada"
        ;;

    *)
        pa_error 400 "Acción de hora no permitida"
        ;;
esac
