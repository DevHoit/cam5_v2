/*
 * update.h — actualización remota del gateway.
 *
 * Core indica en la respuesta del heartbeat la versión que debe tener el equipo:
 *   "update": {"version":"1.3.0","sha256":"…","signature":"<Ed25519 base64>","size":1530112,"attempt":"…"}
 * Si difiere de CAM5_VERSION, el gateway descarga el paquete (GET /gateway/update), comprueba
 * su SHA-256 y la firma Ed25519 con la clave pública grabada en el binario, lo guarda en
 * CAM5_UPDATE_DIR y lanza "hoit_update.sh apply" en una sesión aparte. El instalador reinicia
 * el gateway, confirma la versión cuando el gateway nuevo entrega un lote y, si no lo logra,
 * vuelve a la anterior. El resultado se informa en la salud del heartbeat (updateState…).
 */
#ifndef CAM5_UPDATE_H
#define CAM5_UPDATE_H

#include "compat.h"

#include "http.h"
#include "json.h"

#include <stddef.h>

#define UPDATE_MAX_BYTES (4 * 1024 * 1024)

typedef struct {
    char dir[512];
    char script[512];
    double next_try;          /* tras una descarga o verificación fallida, esperar */
    char skipped[64];         /* versión+intento ya registrados como omitidos (sin repetir el aviso) */
} updater;

void update_init(updater *u, const char *dir, const char *script);

/* Procesa el bloque "update" de una respuesta de Core (puede ser NULL). */
void update_offer(updater *u, http_client *http, const char *token, const json_node *offer);

/* Agrega a la salud del heartbeat ",\"updateState\":…" con el resultado de la última actualización. */
void update_health(const updater *u, strbuf *sb);

/* Comprueba SHA-256 (hex) y firma Ed25519 (base64) del paquete. 0 si es válido. */
int update_verify(const unsigned char *data, size_t len, const char *sha256_hex, const char *signature_b64,
                  char *err, size_t err_len);

#endif
