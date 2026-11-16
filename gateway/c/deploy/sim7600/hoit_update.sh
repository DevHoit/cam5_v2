#!/bin/sh
# HOIT — instalador de actualizaciones remotas del gateway SIM7600.
#
#   hoit_update.sh apply PAQUETE VERSIÓN   instala un paquete ya verificado (lo llama cam5-gateway)
#   hoit_update.sh confirm                 confirma o revierte la instalación pendiente (hoit_keeper, cada 60 s)
#   hoit_update.sh rollback [MOTIVO]       vuelve a la versión anterior a mano
#   hoit_update.sh status                  muestra el resultado de la última actualización
#
# cam5-gateway descarga el paquete desde Core y comprueba su SHA-256 y su firma Ed25519 antes de
# llamar a "apply"; este script no vuelve a verificarlo. El paquete (tar.gz) contiene:
#   VERSION                 versión del paquete (debe coincidir con "cam5-gateway --version")
#   files/<ruta absoluta>   archivos a instalar, p. ej. files/cache/cam5-gateway/cam5-gateway
#
# Solo se copian los archivos que cambiaron y solo dentro de ALLOWED. Antes se guarda una copia de
# cada archivo reemplazado. Después de instalar, la versión queda "pendiente" hasta que el gateway
# nuevo entrega un lote a Core: entonces se confirma y se borra la copia. Si en CONFIRM_S segundos
# con internet no lo logra (no arranca, se cae o Core lo rechaza), se restaura la copia y se
# reinicia lo afectado. Sin internet se espera hasta MAX_WAIT_S antes de revertir.
# Nunca se tocan gateway.env, hoit_conn.conf ni otros archivos de configuración.

DIR="${HOIT_UPDATE_DIR:-/cache/cam5-update}"
LOG="$DIR/update.log"
RESULT="$DIR/result"
PENDING="$DIR/pending"
BACKUP="$DIR/backup"
STAGE="$DIR/stage"
LOCK="$DIR/lock"
ALIVE=/var/run/cam5-gateway.alive
NETSTATUS=/cache/hoit/gateway_status_current.json
CONFIRM_S="${HOIT_UPDATE_CONFIRM_S:-600}"
MAX_WAIT_S="${HOIT_UPDATE_MAX_WAIT_S:-21600}"
ALLOWED="/cache/cam5-gateway/ /data/hoit/bin/ /data/hoit/www/ /etc/init.d/"
# Nunca se reemplazan desde un paquete: credenciales y configuración propias de cada equipo.
PROTECTED="/cache/cam5-gateway/gateway.env /cache/cam5-gateway/config.json /cache/cam5-gateway/config.etag"

mkdir -p "$DIR"

log() {
    [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 65536 ] && mv -f "$LOG" "$LOG.1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

uptime_s() { cut -d. -f1 /proc/uptime; }
kv() { sed -n "s/^$1=//p" "$2" 2>/dev/null | head -1; }

write_result() {
    # $1 estado  $2 versión  $3 versión anterior  $4 detalle
    printf 'state=%s\nversion=%s\nprevious=%s\nat=%s\nerror=%s\n' "$1" "$2" "$3" "$(date +%s)" \
        "$(printf '%s' "$4" | tr '\n=' '  ' | cut -c1-160)" > "$RESULT.tmp" && mv -f "$RESULT.tmp" "$RESULT"
}

current_version() {
    /cache/cam5-gateway/cam5-gateway --version 2>/dev/null | awk '{print $2; exit}'
}

allowed_path() {
    for P in $PROTECTED; do [ "$1" = "$P" ] && return 1; done
    for A in $ALLOWED; do case "$1" in "$A"*) return 0 ;; esac; done
    return 1
}

need_rw_root() {
    case "$1" in /etc/*) mount -o remount,rw / 2>/dev/null ;; esac
}

# Reemplazo atómico: el script o binario en ejecución sigue con el archivo anterior hasta reiniciar.
install_file() {
    SRC="$1"; DEST="$2"
    need_rw_root "$DEST"
    mkdir -p "$(dirname "$DEST")" &&
        cp -p "$SRC" "$DEST.hoit-new" &&
        mv -f "$DEST.hoit-new" "$DEST"
}

# Reinicia solo lo que cambió. $1 = lista de rutas instaladas o restauradas.
restart_changed() {
    LIST="$1"
    grep -qE '^/data/hoit/bin/hoit_wifi_manager\.sh$' "$LIST" && restart_wifi_manager
    grep -qE '^/data/hoit/bin/hoit_conn_runner\.sh$' "$LIST" &&
        { /etc/init.d/hoit_conn stop >/dev/null 2>&1; setsid /etc/init.d/hoit_conn start </dev/null >/dev/null 2>&1; }
    grep -qE '^/data/hoit/bin/hoit_timed$' "$LIST" &&
        { /etc/init.d/hoit_time stop >/dev/null 2>&1; setsid /etc/init.d/hoit_time start </dev/null >/dev/null 2>&1; }
    grep -qE '^/data/hoit/bin/hoit_healthd\.sh$' "$LIST" &&
        { /etc/init.d/hoit_health stop >/dev/null 2>&1; setsid /etc/init.d/hoit_health start </dev/null >/dev/null 2>&1; }
    # init (respawn) vuelve a lanzar el supervisor raíz con la versión nueva.
    grep -qE '^/data/hoit/bin/hoit_keeper\.sh$' "$LIST" &&
        for PID in $(ps | grep '[h]oit_keeper.sh' | awk '{print $1}'); do kill "$PID" 2>/dev/null; done
    # El gateway siempre se reinicia: es el que confirma la versión.
    /etc/init.d/cam5-gateway stop >/dev/null 2>&1
    sleep 2
    setsid /etc/init.d/cam5-gateway start </dev/null >/dev/null 2>&1
    mount -o remount,ro / 2>/dev/null
    return 0
}

# Sin "hoit_wifi stop": su limpieza borra la interfaz wlan1 y cortaría el Wi-Fi.
restart_wifi_manager() {
    PIDF=/data/hoit/state/hoit_wifi_manager.pid
    OLD="$(cat "$PIDF" 2>/dev/null)"
    [ -n "$OLD" ] && kill "$OLD" 2>/dev/null
    I=0
    while [ -n "$OLD" ] && kill -0 "$OLD" 2>/dev/null && [ "$I" -lt 20 ]; do sleep 1; I=$((I + 1)); done
    rm -f "$PIDF"
    setsid nohup /data/hoit/bin/hoit_wifi_manager.sh run >> /data/hoit/logs/hoit_wifi_service.log 2>&1 </dev/null &
}

do_apply() {
    BUNDLE="$1"; VERSION="$2"
    [ -f "$BUNDLE" ] && [ -n "$VERSION" ] || { echo "Uso: $0 apply PAQUETE VERSIÓN"; return 2; }
    if ! mkdir "$LOCK" 2>/dev/null; then
        # Un bloqueo de más de 30 min es de una instalación interrumpida (corte de energía).
        AGE=$(( $(date +%s) - $(stat -c %Y "$LOCK" 2>/dev/null || echo 0) ))
        [ "$AGE" -gt 1800 ] && rmdir "$LOCK" 2>/dev/null && mkdir "$LOCK" 2>/dev/null ||
            { log "Otra actualización en curso: se omite $VERSION"; return 1; }
    fi
    trap 'rmdir "$LOCK" 2>/dev/null' EXIT
    [ -f "$PENDING" ] && { log "Hay una actualización sin confirmar ($(kv version "$PENDING")): se omite $VERSION"; return 1; }

    PREV="$(current_version)"
    log "Instalando $VERSION (actual ${PREV:-desconocida})"
    rm -rf "$STAGE" "$BACKUP"
    mkdir -p "$STAGE" "$BACKUP/files"
    if ! tar -xzf "$BUNDLE" -C "$STAGE" 2>/dev/null; then
        write_result failed "$VERSION" "$PREV" "paquete dañado (tar)"; log "Paquete dañado"; rm -rf "$STAGE"; return 1
    fi
    if [ "$(tr -d ' \r\n' < "$STAGE/VERSION" 2>/dev/null)" != "$VERSION" ]; then
        write_result failed "$VERSION" "$PREV" "VERSION del paquete no coincide"; rm -rf "$STAGE"; return 1
    fi
    [ -d "$STAGE/files" ] || { write_result failed "$VERSION" "$PREV" "paquete sin files/"; rm -rf "$STAGE"; return 1; }

    # 1) Qué cambia: solo rutas permitidas y archivos distintos de los instalados.
    CHANGED="$DIR/changed.list"; : > "$CHANGED"; : > "$BACKUP/new.list"
    for F in $(cd "$STAGE/files" && find . -type f | sed 's#^\./#/#'); do
        if ! allowed_path "$F"; then
            write_result failed "$VERSION" "$PREV" "ruta no permitida: $F"; log "Ruta no permitida en el paquete: $F"
            rm -rf "$STAGE"; return 1
        fi
        if [ -f "$F" ] && [ "$(md5sum < "$F")" = "$(md5sum < "$STAGE/files$F")" ]; then continue; fi
        echo "$F" >> "$CHANGED"
    done
    if [ ! -s "$CHANGED" ]; then
        write_result installed "$VERSION" "$PREV" "sin archivos distintos"; log "$VERSION ya estaba instalada"; rm -rf "$STAGE"; return 0
    fi

    # 2) Copia de lo que se reemplaza (o lista de lo que no existía, para borrarlo al revertir).
    while read -r F; do
        if [ -f "$F" ]; then
            mkdir -p "$BACKUP/files$(dirname "$F")" && cp -p "$F" "$BACKUP/files$F" ||
                { write_result failed "$VERSION" "$PREV" "sin espacio para la copia de $F"; rm -rf "$STAGE" "$BACKUP"; return 1; }
        else
            echo "$F" >> "$BACKUP/new.list"
        fi
    done < "$CHANGED"
    cp "$CHANGED" "$BACKUP/changed.list"

    # 3) Instalación. Si algo falla a mitad, se restaura lo ya copiado.
    while read -r F; do
        if ! install_file "$STAGE/files$F" "$F"; then
            log "No se pudo instalar $F: se restaura la versión anterior"
            restore_backup
            write_result failed "$VERSION" "$PREV" "no se pudo copiar $F"
            restart_changed "$BACKUP/changed.list"
            rm -rf "$STAGE" "$BACKUP"; return 1
        fi
    done < "$CHANGED"
    sync
    rm -rf "$STAGE"
    # El paquete ya no hace falta: la copia de lo anterior está en $BACKUP.
    case "$BUNDLE" in "$DIR"/*) rm -f "$BUNDLE" ;; esac

    # 4) Pendiente de confirmación por el gateway nuevo.
    UP="$(uptime_s)"
    printf 'version=%s\nprevious=%s\napplied_up=%s\ndeadline_up=%s\nhard_deadline_up=%s\nconfirm_s=%s\n' \
        "$VERSION" "$PREV" "$UP" "$((UP + CONFIRM_S))" "$((UP + MAX_WAIT_S))" "$CONFIRM_S" > "$PENDING"
    write_result installing "$VERSION" "$PREV" "$(wc -l < "$CHANGED" | tr -d ' ') archivo(s)"
    log "$VERSION instalada ($(wc -l < "$CHANGED" | tr -d ' ') archivo(s)): reiniciando; se confirma cuando el gateway entregue un lote"
    restart_changed "$CHANGED"
    return 0
}

restore_backup() {
    while read -r F; do
        if [ -f "$BACKUP/files$F" ]; then install_file "$BACKUP/files$F" "$F"
        elif grep -qxF "$F" "$BACKUP/new.list" 2>/dev/null; then need_rw_root "$F"; rm -f "$F"; fi
    done < "$BACKUP/changed.list"
    sync
}

do_rollback() {
    REASON="${1:-manual}"
    [ -f "$PENDING" ] && [ -f "$BACKUP/changed.list" ] || { echo "No hay una actualización pendiente que revertir"; return 1; }
    VERSION="$(kv version "$PENDING")"; PREV="$(kv previous "$PENDING")"
    log "Revirtiendo $VERSION → ${PREV:-anterior}: $REASON"
    restore_backup
    write_result rolled_back "$VERSION" "$PREV" "$REASON"
    rm -f "$PENDING"
    restart_changed "$BACKUP/changed.list"
    rm -rf "$BACKUP"
    return 0
}

has_internet() { grep -Eq '"(wifi_ok|lte_ok)": *1' "$NETSTATUS" 2>/dev/null; }

do_confirm() {
    [ -f "$PENDING" ] || return 0
    VERSION="$(kv version "$PENDING")"; PREV="$(kv previous "$PENDING")"
    UP="$(uptime_s)"; APPLIED="$(kv applied_up "$PENDING")"
    # Reinicio del equipo después de instalar: los plazos se cuentan de nuevo desde el arranque.
    if [ "$UP" -lt "${APPLIED:-0}" ]; then
        WAIT="$(kv confirm_s "$PENDING")"; WAIT="${WAIT:-$CONFIRM_S}"
        printf 'version=%s\nprevious=%s\napplied_up=0\ndeadline_up=%s\nhard_deadline_up=%s\nconfirm_s=%s\n' \
            "$VERSION" "$PREV" "$((UP + WAIT))" "$((UP + MAX_WAIT_S))" "$WAIT" > "$PENDING"
        APPLIED=0
    fi
    RUNNING="$(current_version)"
    LAST="$(kv last_accept "$ALIVE" | cut -d. -f1)"
    if [ "$RUNNING" = "$VERSION" ] && [ "${LAST:-0}" -gt "${APPLIED:-0}" ]; then
        log "$VERSION confirmada: el gateway nuevo entregó datos a Core"
        write_result installed "$VERSION" "$PREV" ""
        rm -f "$PENDING" "$DIR/changed.list"; rm -rf "$BACKUP"
        return 0
    fi
    DEADLINE="$(kv deadline_up "$PENDING")"; HARD="$(kv hard_deadline_up "$PENDING")"
    if [ "$RUNNING" != "$VERSION" ] && [ "$UP" -ge "${DEADLINE:-0}" ]; then
        do_rollback "el binario instalado no informa la versión $VERSION"
    elif [ "$UP" -ge "${DEADLINE:-0}" ] && has_internet; then
        WAIT="$(kv confirm_s "$PENDING")"
        do_rollback "sin lotes entregados en $(( ${WAIT:-$CONFIRM_S} / 60 )) min con internet"
    elif [ "$UP" -ge "${HARD:-0}" ]; then
        do_rollback "sin confirmación en $((MAX_WAIT_S / 3600)) h"
    fi
}

case "$1" in
    apply) do_apply "$2" "$3" ;;
    confirm) do_confirm ;;
    rollback) do_rollback "${2:-manual}" ;;
    status) cat "$RESULT" 2>/dev/null; [ -f "$PENDING" ] && { echo "--- pendiente"; cat "$PENDING"; } ;;
    *) echo "Uso: $0 {apply PAQUETE VERSIÓN|confirm|rollback [MOTIVO]|status}"; exit 1 ;;
esac
