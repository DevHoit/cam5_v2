#!/bin/sh
# Estado del gateway CAM-5 → HoitLive Core para el portal local (solo lectura).
. /data/hoit/lib/portal_auth.sh || exit 1
pa_require_session

DIR="/cache/cam5-gateway"
ENV_FILE="$DIR/gateway.env"
LOG="$DIR/gateway.log"
BIN="$DIR/cam5-gateway"
NET="/cache/hoit/gateway_status_current.json"

envv() { sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | tr -d '\r' | tail -1; }
j() { pa_json_escape "$1"; }

SERVICE="stopped"
/etc/init.d/cam5-gateway status >/dev/null 2>&1 && SERVICE="running"
VERSION="$("$BIN" --version 2>/dev/null | head -1)"
QUEUE="$(ls "$DIR/queue" 2>/dev/null | wc -l | tr -d ' ')"
REJECTED="$(ls "$DIR/rejected" 2>/dev/null | wc -l | tr -d ' ')"
LAST_OK="$(grep -E ' INFO (accepted|duplicate|deferred) ' "$LOG" 2>/dev/null | tail -1)"
LAST_PROBLEM="$(grep -E ' (WARNING|ERROR) ' "$LOG" 2>/dev/null | tail -1)"
LAST_STATS="$(grep ' Estado: ' "$LOG" 2>/dev/null | tail -1)"
# Última línea "Controlador X → host:puerto ..." de cada código, en orden.
CONTROLLERS="$(grep ' Controlador ' "$LOG" 2>/dev/null | tail -40 |
    awk '{for(i=1;i<=NF;i++) if($i=="Controlador"){c=$(i+1); sub(/^.*Controlador /,""); last[c]=$0; if(!(c in seen)){seen[c]=1; order[++n]=c}}}
         END{for(i=1;i<=n;i++) print last[order[i]]}')"
TAIL="$(tail -n 60 "$LOG" 2>/dev/null)"
UPLINK="$(sed -n 's/.*"uplink": *"\([^"]*\)".*/\1/p' "$NET" 2>/dev/null | head -1)"
LTE_STATE="$(sed -n 's/.*"lte_state": *"\([^"]*\)".*/\1/p' "$NET" 2>/dev/null | head -1)"

pa_json_headers
echo ""
cat <<EOF
{"ok":true,
 "service":"$SERVICE",
 "version":"$(j "$VERSION")",
 "api_base":"$(j "$(envv CAM5_API_BASE)")",
 "token_configured":$([ -n "$(envv CAM5_GATEWAY_TOKEN)" ] && echo true || echo false),
 "eth_addr":"$(j "$(envv CAM5_ETH_ADDR)")",
 "host_overrides":"$(j "$(envv CAM5_HOST_OVERRIDES)")",
 "queue":${QUEUE:-0},
 "rejected":${REJECTED:-0},
 "last_ok":"$(j "$LAST_OK")",
 "last_problem":"$(j "$LAST_PROBLEM")",
 "last_stats":"$(j "$LAST_STATS")",
 "controllers":"$(j "$CONTROLLERS")",
 "uplink":"$(j "$UPLINK")",
 "lte_state":"$(j "$LTE_STATE")",
 "log":"$(j "$TAIL")",
 "now":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')"}
EOF
