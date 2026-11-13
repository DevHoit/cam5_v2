#include "compat.h"

#include "http.h"
#include "json.h"
#include "util.h"

#include <arpa/inet.h>
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

#ifdef CAM5_TLS_OPENSSL
#include <openssl/err.h>
#include <openssl/ssl.h>
#include <openssl/x509v3.h>
#endif

#define USER_AGENT "HoitLive-CAM5-Gateway-C/" CAM5_VERSION
#define MAX_HEADER_BYTES (32 * 1024)
#define MAX_BODY_BYTES (4 * 1024 * 1024)
/* Una conexión inactiva más tiempo que esto se descarta: la NAT del operador
 * móvil puede cerrar en silencio los flujos ociosos y la siguiente solicitud
 * quedaría esperando el timeout completo. 90 s cubre la cadencia de un lote
 * por minuto; si el servidor cerró antes, poll() lo detecta sin costo. */
#define MAX_IDLE_SECONDS 90.0

static void set_err(char *err, size_t err_len, const char *fmt, ...) CAM5_PRINTF(3, 4);

static void set_err(char *err, size_t err_len, const char *fmt, ...)
{
    if (!err || !err_len)
        return;
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(err, err_len, fmt, ap);
    va_end(ap);
}

const char *http_tls_backend(void)
{
#ifdef CAM5_TLS_OPENSSL
#if OPENSSL_VERSION_NUMBER >= 0x10100000L
    return OpenSSL_version(OPENSSL_VERSION);
#else
    return SSLeay_version(SSLEAY_VERSION);
#endif
#else
    return "sin TLS (solo HTTP local)";
#endif
}

/* ---- Inicialización ----------------------------------------------------- */

#ifdef CAM5_TLS_OPENSSL
static const char *const CA_CANDIDATES[] = {
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/cert.pem",
    "/usr/share/ca-certificates/ca-bundle.crt",
    NULL,
};

static void openssl_error(char *err, size_t err_len, const char *what)
{
    char detail[256] = "sin detalle";
    unsigned long code = ERR_get_error();
    if (code)
        ERR_error_string_n(code, detail, sizeof(detail));
    ERR_clear_error();
    set_err(err, err_len, "%s: %s", what, detail);
}

static int tls_init(http_client *http, char *err, size_t err_len)
{
#if OPENSSL_VERSION_NUMBER < 0x10100000L
    SSL_library_init();
    SSL_load_error_strings();
    SSL_CTX *ctx = SSL_CTX_new(SSLv23_client_method());
    if (ctx)
        SSL_CTX_set_options(ctx, SSL_OP_NO_SSLv2 | SSL_OP_NO_SSLv3 | SSL_OP_NO_TLSv1 | SSL_OP_NO_TLSv1_1);
#else
    SSL_CTX *ctx = SSL_CTX_new(TLS_client_method());
    if (ctx)
        SSL_CTX_set_min_proto_version(ctx, TLS1_2_VERSION);
#endif
    if (!ctx) {
        openssl_error(err, err_len, "No fue posible crear el contexto TLS");
        return -1;
    }
    SSL_CTX_set_verify(ctx, SSL_VERIFY_PEER, NULL);
    SSL_CTX_set_mode(ctx, SSL_MODE_AUTO_RETRY);
#if OPENSSL_VERSION_NUMBER >= 0x10101000L
    /* OpenSSL 3.5+ ofrece por omisión el intercambio híbrido X25519MLKEM768,
     * que agrega ~2,3 KB a cada handshake (medido: 4,0 KB frente a 1,7 KB).
     * Sobre 4G se prefiere X25519; CAM5_TLS_GROUPS permite cambiarlo. */
    const char *groups = getenv("CAM5_TLS_GROUPS");
    if (SSL_CTX_set1_groups_list(ctx, groups && *groups ? groups : "X25519:P-256") != 1) {
        openssl_error(err, err_len, "CAM5_TLS_GROUPS no es válido");
        SSL_CTX_free(ctx);
        return -1;
    }
#endif

    int loaded = 0;
    if (http->ca_file[0]) {
        if (SSL_CTX_load_verify_locations(ctx, http->ca_file, NULL) != 1) {
            openssl_error(err, err_len, "No fue posible cargar los certificados raíz de CAM5_CA_FILE");
            SSL_CTX_free(ctx);
            return -1;
        }
        loaded = 1;
    } else {
        loaded = SSL_CTX_set_default_verify_paths(ctx) == 1;
        for (int i = 0; CA_CANDIDATES[i]; i++) {
            if (access(CA_CANDIDATES[i], R_OK) == 0 && SSL_CTX_load_verify_locations(ctx, CA_CANDIDATES[i], NULL) == 1) {
                LOGD("Certificados raíz cargados desde %s", CA_CANDIDATES[i]);
                loaded = 1;
                break;
            }
        }
        ERR_clear_error();
    }
    if (!loaded)
        LOGW("No se encontró un almacén de certificados raíz; define CAM5_CA_FILE o el TLS fallará");
    http->ctx = ctx;
    return 0;
}
#endif

int http_init(http_client *http, const char *base_url, const char *ca_file, int timeout_s, char *err, size_t err_len)
{
    memset(http, 0, sizeof(*http));
    http->fd = -1;
    http->timeout_s = timeout_s > 0 ? timeout_s : 20;
    copy_str(http->ca_file, sizeof(http->ca_file), ca_file ? ca_file : "");

    const char *p;
    if (!strncasecmp(base_url, "https://", 8)) {
        http->tls = 1;
        p = base_url + 8;
        copy_str(http->port, sizeof(http->port), "443");
    } else if (!strncasecmp(base_url, "http://", 7)) {
        p = base_url + 7;
        copy_str(http->port, sizeof(http->port), "80");
    } else {
        set_err(err, err_len, "CAM5_API_BASE debe comenzar con https://");
        return -1;
    }

    const char *host_end;
    if (*p == '[') { /* IPv6 literal */
        const char *close = strchr(p, ']');
        if (!close) {
            set_err(err, err_len, "CAM5_API_BASE: dirección IPv6 sin cerrar");
            return -1;
        }
        size_t n = (size_t) (close - p - 1);
        if (n >= sizeof(http->host))
            return -1;
        memcpy(http->host, p + 1, n);
        http->host[n] = '\0';
        host_end = close + 1;
    } else {
        host_end = p + strcspn(p, ":/");
        size_t n = (size_t) (host_end - p);
        if (n == 0 || n >= sizeof(http->host)) {
            set_err(err, err_len, "CAM5_API_BASE no tiene un host válido");
            return -1;
        }
        memcpy(http->host, p, n);
        http->host[n] = '\0';
    }
    p = host_end;
    if (*p == ':') {
        p++;
        size_t n = strspn(p, "0123456789");
        if (n == 0 || n >= sizeof(http->port)) {
            set_err(err, err_len, "CAM5_API_BASE tiene un puerto inválido");
            return -1;
        }
        memcpy(http->port, p, n);
        http->port[n] = '\0';
        p += n;
    }
    if (*p && *p != '/') {
        set_err(err, err_len, "CAM5_API_BASE tiene un formato inválido");
        return -1;
    }
    copy_str(http->base_path, sizeof(http->base_path), p);
    size_t bl = strlen(http->base_path);
    while (bl > 0 && http->base_path[bl - 1] == '/')
        http->base_path[--bl] = '\0';

    if (http->tls) {
#ifdef CAM5_TLS_OPENSSL
        return tls_init(http, err, err_len);
#else
        set_err(err, err_len, "Este binario se compiló sin TLS; recompila con TLS=openssl para usar https://");
        return -1;
#endif
    }
    return 0;
}

void http_disconnect(http_client *http)
{
#ifdef CAM5_TLS_OPENSSL
    if (http->ssl) {
        /* Cierre silencioso: no gasta datos en close_notify y conserva la
         * sesión como reanudable. */
        SSL_set_quiet_shutdown((SSL *) http->ssl, 1);
        SSL_shutdown((SSL *) http->ssl);
        SSL_free((SSL *) http->ssl);
        http->ssl = NULL;
    }
#endif
    if (http->fd >= 0)
        close(http->fd);
    http->fd = -1;
}

void http_cleanup(http_client *http)
{
    http_disconnect(http);
#ifdef CAM5_TLS_OPENSSL
    if (http->session)
        SSL_SESSION_free((SSL_SESSION *) http->session);
    if (http->ctx)
        SSL_CTX_free((SSL_CTX *) http->ctx);
#endif
    http->session = NULL;
    http->ctx = NULL;
}

void http_response_free(http_response *resp)
{
    free(resp->body);
    memset(resp, 0, sizeof(*resp));
}

/* ---- Conexión ----------------------------------------------------------- */

static int tcp_connect(const char *host, const char *port, int timeout_s, char *err, size_t err_len)
{
    struct addrinfo hints, *res = NULL;
    memset(&hints, 0, sizeof(hints));
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    int gai = getaddrinfo(host, port, &hints, &res);
    if (gai != 0) {
        set_err(err, err_len, "No se pudo resolver %s: %s", host, gai_strerror(gai));
        return -1;
    }
    int fd = -1;
    int last_errno = 0;
    for (struct addrinfo *rp = res; rp; rp = rp->ai_next) {
        fd = socket(rp->ai_family, rp->ai_socktype, rp->ai_protocol);
        if (fd < 0)
            continue;
        int flags = fcntl(fd, F_GETFL, 0);
        fcntl(fd, F_SETFL, flags | O_NONBLOCK);
        int rc = connect(fd, rp->ai_addr, rp->ai_addrlen);
        if (rc != 0 && errno == EINPROGRESS) {
            struct pollfd pfd = { fd, POLLOUT, 0 };
            rc = poll(&pfd, 1, timeout_s * 1000);
            if (rc == 1) {
                int so_error = 0;
                socklen_t len = sizeof(so_error);
                getsockopt(fd, SOL_SOCKET, SO_ERROR, &so_error, &len);
                rc = so_error ? -1 : 0;
                errno = so_error;
            } else {
                errno = rc == 0 ? ETIMEDOUT : errno;
                rc = -1;
            }
        }
        if (rc == 0) {
            fcntl(fd, F_SETFL, flags);
            struct timeval tv = { timeout_s, 0 };
            setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
            setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
            int one = 1;
            setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
#ifdef SO_NOSIGPIPE
            setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof(one));
#endif
            break;
        }
        last_errno = errno;
        close(fd);
        fd = -1;
    }
    freeaddrinfo(res);
    if (fd < 0)
        set_err(err, err_len, "No se pudo conectar a %s:%s: %s", host, port, strerror(last_errno));
    return fd;
}

static int is_ip_literal(const char *host)
{
    unsigned char buf[sizeof(struct in6_addr)];
    return inet_pton(AF_INET, host, buf) == 1 || inet_pton(AF_INET6, host, buf) == 1;
}

static int http_connect(http_client *http, char *err, size_t err_len)
{
    http->fd = tcp_connect(http->host, http->port, http->timeout_s, err, err_len);
    if (http->fd < 0)
        return -1;
    http->connections++;
    if (!http->tls)
        return 0;
#ifdef CAM5_TLS_OPENSSL
    SSL *ssl = SSL_new((SSL_CTX *) http->ctx);
    if (!ssl) {
        openssl_error(err, err_len, "SSL_new");
        http_disconnect(http);
        return -1;
    }
    http->ssl = ssl;
    SSL_set_fd(ssl, http->fd);
    X509_VERIFY_PARAM *param = SSL_get0_param(ssl);
    if (is_ip_literal(http->host)) {
        X509_VERIFY_PARAM_set1_ip_asc(param, http->host);
    } else {
        SSL_set_tlsext_host_name(ssl, http->host);
        X509_VERIFY_PARAM_set_hostflags(param, X509_CHECK_FLAG_NO_PARTIAL_WILDCARDS);
        X509_VERIFY_PARAM_set1_host(param, http->host, 0);
    }
    if (http->session)
        SSL_set_session(ssl, (SSL_SESSION *) http->session);
    if (SSL_connect(ssl) != 1) {
        long verify = SSL_get_verify_result(ssl);
        if (verify != X509_V_OK)
            set_err(err, err_len, "Certificado de %s no válido: %s", http->host, X509_verify_cert_error_string(verify));
        else
            openssl_error(err, err_len, "Falló el handshake TLS");
        if (http->session) { /* una sesión vencida no debe bloquear la próxima conexión */
            SSL_SESSION_free((SSL_SESSION *) http->session);
            http->session = NULL;
        }
        http_disconnect(http);
        return -1;
    }
    if (SSL_session_reused(ssl))
        http->resumed++;
    return 0;
#else
    set_err(err, err_len, "TLS no disponible en este binario");
    http_disconnect(http);
    return -1;
#endif
}

/* La conexión ociosa sigue utilizable si el servidor no envió nada (ni cierre). */
static int connection_alive(http_client *http)
{
    if (http->fd < 0)
        return 0;
    if (mono_now() - http->last_used > MAX_IDLE_SECONDS)
        return 0;
    struct pollfd pfd = { http->fd, POLLIN, 0 };
    if (poll(&pfd, 1, 0) != 0)
        return 0; /* datos inesperados, cierre o error */
    return 1;
}

/* ---- E/S ---------------------------------------------------------------- */

static int io_write(http_client *http, const char *data, size_t len)
{
    size_t done = 0;
    while (done < len) {
#ifdef CAM5_TLS_OPENSSL
        if (http->ssl) {
            int chunk = len - done > 65536 ? 65536 : (int) (len - done);
            int n = SSL_write((SSL *) http->ssl, data + done, chunk);
            if (n <= 0)
                return -1;
            done += (size_t) n;
            continue;
        }
#endif
#ifdef MSG_NOSIGNAL
        ssize_t n = send(http->fd, data + done, len - done, MSG_NOSIGNAL);
#else
        ssize_t n = send(http->fd, data + done, len - done, 0);
#endif
        if (n < 0 && errno == EINTR)
            continue;
        if (n <= 0)
            return -1;
        done += (size_t) n;
        http->bytes_sent += (uint64_t) n;
    }
    return 0;
}

/* Devuelve bytes leídos, 0 en fin de conexión, -1 en error. */
static long io_read(http_client *http, char *buf, size_t cap)
{
#ifdef CAM5_TLS_OPENSSL
    if (http->ssl) {
        int n = SSL_read((SSL *) http->ssl, buf, cap > 65536 ? 65536 : (int) cap);
        if (n > 0)
            return n;
        int e = SSL_get_error((SSL *) http->ssl, n);
        if (e == SSL_ERROR_ZERO_RETURN)
            return 0;
        if (e == SSL_ERROR_SYSCALL && n == 0 && ERR_peek_error() == 0)
            return 0; /* EOF sin close_notify, habitual en servidores HTTP */
        ERR_clear_error();
        return -1;
    }
#endif
    for (;;) {
        ssize_t n = recv(http->fd, buf, cap, 0);
        if (n < 0 && errno == EINTR)
            continue;
        if (n > 0)
            http->bytes_received += (uint64_t) n;
        return (long) n;
    }
}

typedef struct {
    http_client *http;
    char buf[8192];
    size_t pos;
    size_t len;
    int eof;
} reader;

static int reader_fill(reader *r)
{
    if (r->pos < r->len)
        return 0;
    long n = io_read(r->http, r->buf, sizeof(r->buf));
    if (n < 0)
        return -1;
    if (n == 0) {
        r->eof = 1;
        return -1;
    }
    r->pos = 0;
    r->len = (size_t) n;
    return 0;
}

/* Lee una línea terminada en CRLF, sin el terminador. */
static int reader_line(reader *r, char *out, size_t cap)
{
    size_t n = 0;
    for (;;) {
        if (reader_fill(r) != 0)
            return -1;
        char c = r->buf[r->pos++];
        if (c == '\n') {
            if (n > 0 && out[n - 1] == '\r')
                n--;
            out[n] = '\0';
            return 0;
        }
        if (n + 1 >= cap)
            return -1;
        out[n++] = c;
    }
}

static int reader_bytes(reader *r, strbuf *out, size_t count)
{
    while (count > 0) {
        if (reader_fill(r) != 0)
            return -1;
        size_t take = r->len - r->pos;
        if (take > count)
            take = count;
        sb_append(out, r->buf + r->pos, take);
        r->pos += take;
        count -= take;
    }
    return out->failed ? -1 : 0;
}

static int contains_ci(const char *haystack, const char *needle)
{
    size_t n = strlen(needle);
    for (; *haystack; haystack++)
        if (!strncasecmp(haystack, needle, n))
            return 1;
    return 0;
}

static void trim(char *s)
{
    size_t n = strlen(s);
    while (n > 0 && isspace((unsigned char) s[n - 1]))
        s[--n] = '\0';
    size_t lead = strspn(s, " \t");
    if (lead)
        memmove(s, s + lead, n - lead + 1);
}

static int read_response(http_client *http, const char *method, http_response *resp, int *keep_alive, char *err, size_t err_len)
{
    reader r;
    memset(&r, 0, sizeof(r));
    r.http = http;
    char line[4096];
    size_t header_bytes = 0;

    int status = 0, minor = 1;
    do { /* ignora respuestas 1xx */
        if (reader_line(&r, line, sizeof(line)) != 0) {
            set_err(err, err_len, r.eof ? "El servidor cerró la conexión sin responder" : "Sin respuesta del servidor (timeout)");
            return -1;
        }
        if (sscanf(line, "HTTP/1.%d %d", &minor, &status) != 2) {
            set_err(err, err_len, "Respuesta HTTP inválida");
            return -1;
        }
        if (status >= 100 && status < 200)
            while (reader_line(&r, line, sizeof(line)) == 0 && line[0]) {
            }
    } while (status >= 100 && status < 200);

    long long content_length = -1;
    int chunked = 0;
    *keep_alive = minor >= 1;
    for (;;) {
        if (reader_line(&r, line, sizeof(line)) != 0) {
            set_err(err, err_len, "Cabeceras HTTP incompletas");
            return -1;
        }
        header_bytes += strlen(line) + 2;
        if (header_bytes > MAX_HEADER_BYTES) {
            set_err(err, err_len, "Cabeceras HTTP demasiado grandes");
            return -1;
        }
        if (!line[0])
            break;
        char *colon = strchr(line, ':');
        if (!colon)
            continue;
        *colon = '\0';
        char *value = colon + 1;
        trim(value);
        if (!strcasecmp(line, "Content-Length"))
            content_length = strtoll(value, NULL, 10);
        else if (!strcasecmp(line, "Transfer-Encoding"))
            chunked = contains_ci(value, "chunked");
        else if (!strcasecmp(line, "Connection")) {
            if (contains_ci(value, "close"))
                *keep_alive = 0;
            else if (contains_ci(value, "keep-alive"))
                *keep_alive = 1;
        } else if (!strcasecmp(line, "ETag"))
            copy_str(resp->etag, sizeof(resp->etag), value);
    }
    resp->status = status;

    strbuf body;
    sb_init(&body);
    int no_body = !strcmp(method, "HEAD") || status == 204 || status == 304;
    if (!no_body) {
        if (chunked) {
            for (;;) {
                if (reader_line(&r, line, sizeof(line)) != 0)
                    goto truncated;
                unsigned long size = strtoul(line, NULL, 16);
                if (size == 0) {
                    while (reader_line(&r, line, sizeof(line)) == 0 && line[0]) {
                    }
                    break;
                }
                if (body.len + size > MAX_BODY_BYTES || reader_bytes(&r, &body, size) != 0)
                    goto truncated;
                if (reader_line(&r, line, sizeof(line)) != 0)
                    goto truncated;
            }
        } else if (content_length >= 0) {
            if (content_length > MAX_BODY_BYTES || reader_bytes(&r, &body, (size_t) content_length) != 0)
                goto truncated;
        } else {
            *keep_alive = 0;
            while (reader_fill(&r) == 0) {
                if (body.len + (r.len - r.pos) > MAX_BODY_BYTES)
                    goto truncated;
                sb_append(&body, r.buf + r.pos, r.len - r.pos);
                r.pos = r.len;
            }
        }
    }
    if (body.failed)
        goto truncated;
    if (r.pos < r.len)
        *keep_alive = 0; /* bytes de más: no se reutiliza una conexión ambigua */
    resp->body = body.data ? body.data : calloc(1, 1);
    resp->body_len = body.len;
    return 0;

truncated:
    sb_free(&body);
    set_err(err, err_len, "Respuesta HTTP incompleta o demasiado grande (estado %d)", status);
    return -1;
}

static void account_tls_bytes(http_client *http, uint64_t *last_out, uint64_t *last_in)
{
#ifdef CAM5_TLS_OPENSSL
    if (!http->ssl)
        return;
    uint64_t out = (uint64_t) BIO_number_written(SSL_get_wbio((SSL *) http->ssl));
    uint64_t in = (uint64_t) BIO_number_read(SSL_get_rbio((SSL *) http->ssl));
    http->bytes_sent += out - *last_out;
    http->bytes_received += in - *last_in;
    *last_out = out;
    *last_in = in;
#else
    (void) http;
    (void) last_out;
    (void) last_in;
#endif
}

static void remember_session(http_client *http)
{
#ifdef CAM5_TLS_OPENSSL
    if (!http->ssl)
        return;
    SSL_SESSION *session = SSL_get1_session((SSL *) http->ssl);
    if (!session)
        return;
    if (http->session)
        SSL_SESSION_free((SSL_SESSION *) http->session);
    http->session = session;
#else
    (void) http;
#endif
}

int http_request(http_client *http, const char *method, const char *path, const char *token,
                 const char *body, size_t body_len, const char *if_none_match,
                 http_response *resp, char *err, size_t err_len)
{
    memset(resp, 0, sizeof(*resp));
    strbuf req;
    sb_init(&req);
    sb_printf(&req, "%s %s%s HTTP/1.1\r\n", method, http->base_path, path);
    if (!strcmp(http->port, http->tls ? "443" : "80"))
        sb_printf(&req, "Host: %s\r\n", http->host);
    else
        sb_printf(&req, "Host: %s:%s\r\n", http->host, http->port);
    sb_printf(&req, "User-Agent: %s\r\nAccept: application/json\r\n", USER_AGENT);
    if (token && *token)
        sb_printf(&req, "Authorization: Bearer %s\r\n", token);
    if (if_none_match && *if_none_match)
        sb_printf(&req, "If-None-Match: %s\r\n", if_none_match);
    if (body)
        sb_printf(&req, "Content-Type: application/json\r\nContent-Length: %lu\r\n", (unsigned long) body_len);
    sb_puts(&req, "\r\n");
    if (body)
        sb_append(&req, body, body_len);
    if (req.failed) {
        sb_free(&req);
        set_err(err, err_len, "Sin memoria para armar la solicitud");
        return -1;
    }

    int result = -1;
    for (int attempt = 0; attempt < 2; attempt++) {
        int reused = 0;
        if (connection_alive(http)) {
            reused = 1;
        } else {
            http_disconnect(http);
            if (http_connect(http, err, err_len) != 0)
                break;
        }
        uint64_t out0 = 0, in0 = 0;
#ifdef CAM5_TLS_OPENSSL
        if (http->ssl) {
            out0 = (uint64_t) BIO_number_written(SSL_get_wbio((SSL *) http->ssl));
            in0 = (uint64_t) BIO_number_read(SSL_get_rbio((SSL *) http->ssl));
            if (!reused) { /* el handshake recién hecho también cuenta */
                http->bytes_sent += out0;
                http->bytes_received += in0;
            }
        }
#endif
        int keep_alive = 0;
        int ok = io_write(http, req.data, req.len) == 0;
        if (!ok)
            set_err(err, err_len, "No se pudo enviar la solicitud: %s", strerror(errno));
        if (ok && read_response(http, method, resp, &keep_alive, err, err_len) == 0) {
            account_tls_bytes(http, &out0, &in0);
            http->requests++;
            http->last_used = mono_now();
            remember_session(http);
            if (!keep_alive)
                http_disconnect(http);
            result = 0;
            break;
        }
        account_tls_bytes(http, &out0, &in0);
        http_disconnect(http);
        http_response_free(resp);
        /* Si falló sobre una conexión reutilizada, el servidor pudo haberla
         * cerrado mientras estaba ociosa: se intenta una vez con una nueva.
         * Es seguro porque el portal deduplica por batchKey. */
        if (!reused)
            break;
        LOGD("Conexión reutilizada no respondió (%s); se reintenta con una nueva", err);
    }
    sb_free(&req);
    return result;
}
