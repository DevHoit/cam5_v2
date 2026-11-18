#!/bin/sh
# Arma y firma un paquete de actualización remota para el gateway SIM7600.
#
#   sh gateway/tools/release/build_release.sh 1.3.0            (arma y firma)
#   sh gateway/tools/release/build_release.sh 1.3.0 --no-sign  (solo arma; firmar después con
#       node gateway/tools/release/sign_release.mjs dist/cam5-gateway-1.3.0.tar.gz)
#
# 1. Compila cam5-gateway para ARMv7 (Alpine armv7 en Docker, estático) y comprueba que
#    "--version" informe la versión pedida (CAM5_VERSION en gateway/c/src/compat.h).
# 2. Junta el binario, los scripts de /data/hoit/bin, el init y el portal en files/<ruta>.
# 3. Crea dist/cam5-gateway-VERSIÓN.tar.gz y lo firma (dist/…tar.gz.sig) con la clave de
#    ~/.hoit/gateway-release-ed25519.pem.
# Después se publica en Core → Provisionamiento → Versiones del gateway (paquete + firma).
set -eu
VERSION="${1:?Uso: build_release.sh VERSIÓN [--no-sign]}"
SIGN=1
[ "${2:-}" = "--no-sign" ] && SIGN=0
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
C="$ROOT/gateway/c"
D="$C/deploy"
OUT="$ROOT/dist"

grep -q "#define CAM5_VERSION \"$VERSION\"" "$C/src/compat.h" ||
    { echo "CAM5_VERSION en gateway/c/src/compat.h no es $VERSION"; exit 1; }
[ "$SIGN" = 0 ] || [ -f "$HOME/.hoit/gateway-release-ed25519.pem" ] || [ -n "${HOIT_RELEASE_KEY:-}" ] ||
    { echo "Falta la clave privada ~/.hoit/gateway-release-ed25519.pem"; exit 1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/cam5-release.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
STAGE="$WORK/pkg"
mkdir -p "$STAGE/files/cache/cam5-gateway" "$STAGE/files/data/hoit/bin" "$STAGE/files/data/hoit/www/assets" \
         "$STAGE/files/data/hoit/www/cgi-bin" "$STAGE/files/etc/init.d" "$OUT"

echo "== Compilando cam5-gateway $VERSION (ARMv7, musl estático con OpenSSL)"
# La misma receta del binario que corre en los equipos: Alpine armv7 emulado, todo enlazado estático
# (el SIM7600 no tiene libssl). Se ejecuta "--version" dentro del contenedor para comprobarlo.
docker run --rm --platform linux/arm/v7 -v "$C":/src:ro -v "$WORK":/out alpine:3.20 sh -c '
set -e
apk add --no-cache build-base openssl-dev openssl-libs-static >/dev/null
cp -r /src /build && cd /build && make clean >/dev/null
make check OPTFLAGS="-Os -static" OPENSSL_LIBS="-lssl -lcrypto" >/dev/null
strip cam5-gateway
./cam5-gateway --version > /out/version.txt
cp cam5-gateway /out/cam5-gateway'
grep -q "^cam5-gateway $VERSION " "$WORK/version.txt" ||
    { echo "El binario informa: $(cat "$WORK/version.txt")"; exit 1; }
cp "$WORK/cam5-gateway" "$STAGE/files/cache/cam5-gateway/cam5-gateway"

S="$D/sim7600"
for F in hoit_conn_watchdog.sh hoit_conn_runner.sh hoit_wifi_manager.sh hoit_firewall.sh hoit_healthd.sh \
         hoit_keeper.sh hoit_lte_apply_worker.sh hoit_timed hoit_update.sh; do
    cp "$S/$F" "$STAGE/files/data/hoit/bin/$F"
done
cp "$D/cam5-gateway.init" "$STAGE/files/etc/init.d/cam5-gateway"
(cd "$S/portal" && for F in *.html assets/* cgi-bin/*; do cp "$F" "$STAGE/files/data/hoit/www/$F"; done)
chmod 755 "$STAGE/files/cache/cam5-gateway/cam5-gateway" "$STAGE/files/data/hoit/bin/"* \
          "$STAGE/files/etc/init.d/cam5-gateway" "$STAGE/files/data/hoit/www/cgi-bin/"*
chmod 644 "$STAGE/files/data/hoit/www/"*.html "$STAGE/files/data/hoit/www/assets/"*
for F in "$STAGE/files/data/hoit/bin/"*.sh "$STAGE/files/etc/init.d/cam5-gateway"; do sh -n "$F"; done
echo "$VERSION" > "$STAGE/VERSION"

BUNDLE="$OUT/cam5-gateway-$VERSION.tar.gz"
# tar de GNU: formato ustar, dueño root y orden fijo (lo lee el tar de busybox del equipo).
docker run --rm -v "$STAGE":/pkg:ro -v "$OUT":/out alpine:3.20 sh -c \
    "apk add --no-cache tar >/dev/null && cd /pkg && tar --format=ustar --owner=0 --group=0 --sort=name -cf - VERSION files | gzip -9n > /out/$(basename "$BUNDLE")"
if [ "$SIGN" = 0 ]; then
    rm -f "$BUNDLE.sig"
    echo "== Listo sin firmar: $BUNDLE ($(wc -c < "$BUNDLE" | tr -d ' ') bytes)"
    echo "   Fírmalo con: node gateway/tools/release/sign_release.mjs $BUNDLE"
    exit 0
fi
node "$ROOT/gateway/tools/release/sign_release.mjs" "$BUNDLE" ${HOIT_RELEASE_KEY:+"$HOIT_RELEASE_KEY"}
echo "== Listo: $BUNDLE ($(wc -c < "$BUNDLE" | tr -d ' ') bytes) y $BUNDLE.sig"
echo "   Publícalo en Core → Provisionamiento → Versiones del gateway."
