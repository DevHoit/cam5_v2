/*
 * http.h — cliente HTTP/1.1 mínimo con TLS (OpenSSL) para HoitLive Core.
 *
 * Pensado para 4G: mantiene la conexión abierta entre solicitudes y reanuda
 * la sesión TLS al reconectar, para no repetir el handshake completo
 * (varios KB cada vez) en cada lote o heartbeat.
 */
#ifndef CAM5_HTTP_H
#define CAM5_HTTP_H

#include "compat.h"

#include <stddef.h>
#include <stdint.h>

typedef struct {
    int tls;
    char host[256];
    char port[8];
    char base_path[256];  /* p. ej. /api/v1, sin barra final */
    char ca_file[512];
    int timeout_s;
    int fd;
    void *ctx;            /* SSL_CTX* */
    void *ssl;            /* SSL* */
    void *session;        /* SSL_SESSION* para reanudar */
    double last_used;
    /* Estadísticas, para estimar el consumo del plan de datos. */
    uint64_t bytes_sent;
    uint64_t bytes_received;
    unsigned long connections;
    unsigned long resumed;
    unsigned long requests;
} http_client;

typedef struct {
    int status;
    char *body;
    size_t body_len;
    char etag[160];
} http_response;

int http_init(http_client *http, const char *base_url, const char *ca_file, int timeout_s, char *err, size_t err_len);
void http_cleanup(http_client *http);
void http_disconnect(http_client *http);

/*
 * Ejecuta una solicitud contra base_path + path. Devuelve 0 si llegó una
 * respuesta HTTP (de cualquier código) y -1 ante fallo de red o TLS.
 * if_none_match puede ser NULL. Libera la respuesta con http_response_free.
 */
int http_request(http_client *http, const char *method, const char *path, const char *token,
                 const char *body, size_t body_len, const char *if_none_match,
                 http_response *resp, char *err, size_t err_len);
void http_response_free(http_response *resp);

/* Descripción del backend TLS compilado, para el registro de arranque. */
const char *http_tls_backend(void);

#endif
