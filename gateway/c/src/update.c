#include "compat.h"

#include "update.h"
#include "util.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#ifdef CAM5_TLS_OPENSSL
#include <openssl/evp.h>
#endif

#define RETRY_AFTER_FAILURE_S 3600.0

/* Clave pública Ed25519 de las versiones HOIT. La privada nunca sale del equipo que firma
 * (gateway/tools/release); cambiarla exige instalar a mano un binario con la clave nueva. */
static const unsigned char RELEASE_PUBLIC_KEY[32] = {
    0x19, 0xec, 0x63, 0x73, 0x86, 0xb7, 0x7d, 0x8e, 0x22, 0xdc, 0xa5, 0x7f, 0xf7, 0x21, 0x64, 0x9e,
    0x8d, 0xa7, 0x4f, 0x52, 0x07, 0x4c, 0x9a, 0xed, 0xb3, 0x1c, 0x0f, 0xb1, 0x7f, 0x8c, 0x57, 0x58,
};

void update_init(updater *u, const char *dir, const char *script)
{
    memset(u, 0, sizeof(*u));
    copy_str(u->dir, sizeof(u->dir), dir);
    copy_str(u->script, sizeof(u->script), script);
}

static void path_in(const updater *u, char *out, size_t size, const char *name)
{
    snprintf(out, size, "%s/%s", u->dir, name);
}

/* Valor de "clave=" en un archivo de líneas clave=valor; "" si no está. */
static void file_value(const char *path, const char *key, char *out, size_t size)
{
    out[0] = '\0';
    char *text = read_file(path, NULL, 8192);
    if (!text)
        return;
    size_t klen = strlen(key);
    for (char *line = text; line && *line;) {
        char *end = strchr(line, '\n');
        if (end)
            *end = '\0';
        if (!strncmp(line, key, klen) && line[klen] == '=') {
            copy_str(out, size, line + klen + 1);
            break;
        }
        line = end ? end + 1 : NULL;
    }
    free(text);
}

static int safe_version(const char *v)
{
    size_t n = strlen(v);
    if (n == 0 || n > 39)
        return 0;
    for (const char *p = v; *p; p++)
        if (!((*p >= '0' && *p <= '9') || (*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') || *p == '.' || *p == '-' || *p == '+'))
            return 0;
    return 1;
}

static int b64_value(int c)
{
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+' || c == '-') return 62;
    if (c == '/' || c == '_') return 63;
    return -1;
}

static int b64_decode(const char *in, unsigned char *out, size_t max, size_t *out_len)
{
    unsigned int acc = 0;
    int bits = 0;
    size_t n = 0;
    for (const char *p = in; *p && *p != '='; p++) {
        int v = b64_value((unsigned char) *p);
        if (v < 0)
            return -1;
        acc = (acc << 6) | (unsigned int) v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            if (n >= max)
                return -1;
            out[n++] = (unsigned char) ((acc >> bits) & 0xFF);
        }
    }
    *out_len = n;
    return 0;
}

int update_verify(const unsigned char *data, size_t len, const char *sha256_hex, const char *signature_b64,
                  char *err, size_t err_len)
{
#ifdef CAM5_TLS_OPENSSL
    unsigned char digest[EVP_MAX_MD_SIZE];
    unsigned int dlen = 0;
    if (!EVP_Digest(data, len, digest, &dlen, EVP_sha256(), NULL) || dlen != 32) {
        snprintf(err, err_len, "no se pudo calcular SHA-256");
        return -1;
    }
    char hex[65];
    for (unsigned int i = 0; i < 32; i++)
        snprintf(hex + i * 2, 3, "%02x", digest[i]);
    if (!sha256_hex || strcasecmp(hex, sha256_hex) != 0) {
        snprintf(err, err_len, "SHA-256 no coincide (%.12s…)", hex);
        return -1;
    }
    unsigned char sig[96];
    size_t slen = 0;
    if (!signature_b64 || b64_decode(signature_b64, sig, sizeof(sig), &slen) != 0 || slen != 64) {
        snprintf(err, err_len, "firma con formato inválido");
        return -1;
    }
    EVP_PKEY *key = EVP_PKEY_new_raw_public_key(EVP_PKEY_ED25519, NULL, RELEASE_PUBLIC_KEY, sizeof(RELEASE_PUBLIC_KEY));
    EVP_MD_CTX *ctx = EVP_MD_CTX_new();
    int ok = key && ctx && EVP_DigestVerifyInit(ctx, NULL, NULL, NULL, key) == 1 &&
             EVP_DigestVerify(ctx, sig, slen, data, len) == 1;
    EVP_MD_CTX_free(ctx);
    EVP_PKEY_free(key);
    if (!ok) {
        snprintf(err, err_len, "firma Ed25519 inválida");
        return -1;
    }
    return 0;
#else
    (void) data; (void) len; (void) sha256_hex; (void) signature_b64;
    snprintf(err, err_len, "binario sin OpenSSL: no puede verificar firmas");
    return -1;
#endif
}

/* Lanza el instalador separado del gateway (doble fork + setsid): el instalador detiene y
 * reinicia este proceso, así que no puede ser su hijo. */
static int spawn_installer(const updater *u, const char *bundle, const char *version)
{
    pid_t pid = fork();
    if (pid < 0)
        return -1;
    if (pid == 0) {
        setsid();
        pid_t grandchild = fork();
        if (grandchild != 0)
            _exit(grandchild < 0 ? 1 : 0);
        int fd = open("/dev/null", O_RDWR);
        if (fd >= 0) {
            dup2(fd, 0);
            dup2(fd, 1);
            dup2(fd, 2);
            if (fd > 2)
                close(fd);
        }
        for (int i = 3; i < 256; i++)
            close(i);
        execl("/bin/sh", "sh", u->script, "apply", bundle, version, (char *) NULL);
        _exit(127);
    }
    int status = 0;
    while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {
    }
    return WIFEXITED(status) && WEXITSTATUS(status) == 0 ? 0 : -1;
}

static void skip_once(updater *u, const char *version, const char *attempt, const char *reason)
{
    char key[64];
    snprintf(key, sizeof(key), "%s %s", version, attempt);
    if (strcmp(u->skipped, key) != 0) {
        LOGW("Actualización %s omitida: %s", version, reason);
        copy_str(u->skipped, sizeof(u->skipped), key);
    }
}

void update_offer(updater *u, http_client *http, const char *token, const json_node *offer)
{
    if (!offer || offer->type != JSON_OBJECT)
        return;
    const char *version = json_string_or(json_get(offer, "version"), "");
    const char *sha = json_string_or(json_get(offer, "sha256"), "");
    const char *sig = json_string_or(json_get(offer, "signature"), "");
    const char *attempt = json_string_or(json_get(offer, "attempt"), "");
    double size = json_number_or(json_get(offer, "size"), 0);
    if (!safe_version(version) || !strcmp(version, CAM5_VERSION))
        return;
    if (strlen(attempt) > 24)
        attempt = "";
    if (size <= 0 || size > UPDATE_MAX_BYTES) {
        skip_once(u, version, attempt, "tamaño del paquete fuera de rango");
        return;
    }
    if (access(u->script, X_OK) != 0) {
        skip_once(u, version, attempt, "el equipo no tiene el instalador (hoit_update.sh)");
        return;
    }

    char result[600], pending[600], attempt_path[600];
    path_in(u, result, sizeof(result), "result");
    path_in(u, pending, sizeof(pending), "pending");
    path_in(u, attempt_path, sizeof(attempt_path), "attempt");
    if (access(pending, F_OK) == 0)
        return; /* instalación en curso: la confirma o la revierte hoit_update.sh */
    char state[32], last_version[48], last_attempt[96], this_attempt[96];
    file_value(result, "state", state, sizeof(state));
    file_value(result, "version", last_version, sizeof(last_version));
    file_value(attempt_path, "attempt", last_attempt, sizeof(last_attempt));
    snprintf(this_attempt, sizeof(this_attempt), "%s %s", version, attempt);
    /* Una versión que falló o se revirtió no se reintenta hasta que Core la vuelva a asignar
     * (cambia "attempt"): así un paquete malo no se instala y revierte en bucle. */
    if (!strcmp(last_version, version) && (!strcmp(state, "failed") || !strcmp(state, "rolled_back")) &&
        !strcmp(last_attempt, this_attempt)) {
        skip_once(u, version, attempt, "ya falló en este equipo; reasígnala en Core para reintentar");
        return;
    }
    double now = mono_now();
    if (now < u->next_try)
        return;
    u->next_try = now + RETRY_AFTER_FAILURE_S;

    LOGI("Actualización disponible: %s → %s (%.0f KB); descargando", CAM5_VERSION, version, size / 1024.0);
    http_response resp;
    char err[300];
    if (http_request(http, "GET", "/gateway/update", token, NULL, 0, NULL, &resp, err, sizeof(err)) != 0) {
        LOGW("No se pudo descargar la actualización %s: %s; nuevo intento en 1 h", version, err);
        return;
    }
    if (resp.status != 200 || resp.body_len != (size_t) size) {
        LOGW("Descarga de la actualización %s rechazada (HTTP %d, %lu de %.0f bytes); nuevo intento en 1 h", version,
             resp.status, (unsigned long) resp.body_len, size);
        http_response_free(&resp);
        return;
    }
    if (update_verify((const unsigned char *) resp.body, resp.body_len, sha, sig, err, sizeof(err)) != 0) {
        LOGE("Actualización %s descartada: %s", version, err);
        http_response_free(&resp);
        return;
    }
    char bundle[600];
    path_in(u, bundle, sizeof(bundle), "bundle.tar.gz");
    if (mkdir_p(u->dir) != 0 || write_file_atomic(bundle, resp.body, resp.body_len) != 0) {
        LOGE("No se pudo guardar la actualización en %s: %s", bundle, strerror(errno));
        http_response_free(&resp);
        return;
    }
    http_response_free(&resp);
    char line[128];
    int n = snprintf(line, sizeof(line), "attempt=%s\n", this_attempt);
    write_file_atomic(attempt_path, line, (size_t) n);
    LOGI("Actualización %s verificada (SHA-256 y firma): instalando; el gateway se reiniciará", version);
    if (spawn_installer(u, bundle, version) != 0)
        LOGE("No se pudo lanzar el instalador %s", u->script);
}

void update_health(const updater *u, strbuf *sb)
{
    char path[600], state[32], version[48], error[200];
    path_in(u, path, sizeof(path), "result");
    file_value(path, "state", state, sizeof(state));
    if (!state[0])
        return;
    file_value(path, "version", version, sizeof(version));
    file_value(path, "error", error, sizeof(error));
    sb_puts(sb, ",\"updateState\":");
    sb_json_string(sb, state);
    if (version[0]) {
        sb_puts(sb, ",\"updateVersion\":");
        sb_json_string(sb, version);
    }
    if (error[0]) {
        sb_puts(sb, ",\"updateError\":");
        sb_json_string(sb, error);
    }
}
