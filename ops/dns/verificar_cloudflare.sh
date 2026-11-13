#!/bin/sh
# Compara los registros de hoitlive.com entre el DNS actual (ns2.mysitehosted.com,
# el que está sincronizado) y el nameserver que Cloudflare asignó.
#
# Uso, ANTES de cambiar los nameservers en GoDaddy:
#   sh ops/dns/verificar_cloudflare.sh nombre.ns.cloudflare.com
#
# Uso, DESPUÉS del cambio (revisa delegación y resolvers públicos):
#   sh ops/dns/verificar_cloudflare.sh --despues
#
# Sale con 0 si todo coincide y con 1 si hay diferencias.

ZONE_FILE="$(dirname "$0")/hoitlive.com.zone"
OLD_NS=162.214.129.78   # ns2.mysitehosted.com
DOMAIN=hoitlive.com

norm() {
    # minúsculas, sin punto final, TXT partidos unidos, ordenado
    sed -e 's/" "//g' -e 's/\.$//' | tr 'A-Z' 'a-z' | sort
}

if [ "$1" = "--despues" ]; then
    echo "Delegación (debe mostrar *.ns.cloudflare.com):"
    dig +noall +authority NS "$DOMAIN" @a.gtld-servers.net +norec | awk '{print "  " $5}'
    echo "core.$DOMAIN en resolvers públicos (debe ser NOERROR en todos):"
    for r in 1.1.1.1 8.8.8.8 9.9.9.9 208.67.222.222; do
        st=$(dig "core.$DOMAIN" A @"$r" +time=3 +tries=1 | grep -oE 'status: [A-Z]+' | cut -d' ' -f2)
        echo "  $r: ${st:-sin respuesta}"
    done
    echo "Correo: MX = $(dig +short MX "$DOMAIN" @1.1.1.1 | tr '\n' ' ')"
    exit 0
fi

NEW_NS="$1"
[ -n "$NEW_NS" ] || { echo "Uso: $0 nombre.ns.cloudflare.com | --despues"; exit 2; }
[ -r "$ZONE_FILE" ] || { echo "No encuentro $ZONE_FILE"; exit 2; }

ok=0; bad=0
grep -vE '^(;|\$|[[:space:]]*$)' "$ZONE_FILE" | awk '{print $1, $4}' | sort -u |
while read -r name type; do
    a=$(dig +short "$name" "$type" @"$OLD_NS" +norec +time=3 | norm)
    b=$(dig +short "$name" "$type" @"$NEW_NS" +norec +time=3 | norm)
    if [ "$a" = "$b" ] && [ -n "$b" ]; then
        printf '  OK    %-6s %s\n' "$type" "$name"
    else
        printf '  DIFF  %-6s %s\n        actual:     %s\n        cloudflare: %s\n' \
            "$type" "$name" "$(echo "$a" | tr '\n' ' ' | cut -c1-90)" "$(echo "$b" | tr '\n' ' ' | cut -c1-90)"
        echo x >> "${TMPDIR:-/tmp}/cf_diff.$$"
    fi
done

if [ -f "${TMPDIR:-/tmp}/cf_diff.$$" ]; then
    n=$(wc -l < "${TMPDIR:-/tmp}/cf_diff.$$" | tr -d ' '); rm -f "${TMPDIR:-/tmp}/cf_diff.$$"
    echo "Resultado: $n registro(s) distintos. Corrígelos en Cloudflare antes de cambiar los nameservers."
    exit 1
fi
echo "Resultado: todo coincide. Ya puedes cambiar los nameservers en GoDaddy."
