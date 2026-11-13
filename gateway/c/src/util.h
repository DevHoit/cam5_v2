#ifndef CAM5_UTIL_H
#define CAM5_UTIL_H

#include "compat.h"

#include <stddef.h>
#include <stdint.h>

/* ---- Registro de eventos ------------------------------------------------ */

enum { LOG_LVL_DEBUG = 10, LOG_LVL_INFO = 20, LOG_LVL_WARN = 30, LOG_LVL_ERROR = 40 };

int log_level_from_name(const char *name);
void log_set_level(int level);
int log_get_level(void);
/* Si path no es NULL, escribe en ese archivo y lo rota al superar max_bytes. */
int log_open_file(const char *path, long max_bytes);
void log_msg(int level, const char *fmt, ...) CAM5_PRINTF(2, 3);

#define LOGD(...) log_msg(LOG_LVL_DEBUG, __VA_ARGS__)
#define LOGI(...) log_msg(LOG_LVL_INFO, __VA_ARGS__)
#define LOGW(...) log_msg(LOG_LVL_WARN, __VA_ARGS__)
#define LOGE(...) log_msg(LOG_LVL_ERROR, __VA_ARGS__)

/* ---- Tiempo ------------------------------------------------------------- */

/* Segundos monótonos; no saltan cuando cambia la hora del sistema. */
double mono_now(void);
/* Milisegundos desde 1970 en UTC, corregidos con la hora del servidor. */
int64_t wall_ms(void);
/* Milisegundos desde 1970 según el reloj del sistema, sin corrección. */
int64_t system_ms(void);
/* Ajusta la corrección con una medición de la hora del servidor. */
void clock_observe_server(int64_t server_ms, int64_t local_ms);
int64_t clock_offset_ms(void);
int clock_offset_known(void);
/* El reloj es utilizable: está sincronizado o se conoce la hora del servidor. */
int clock_trusted(void);

#define ISO_LEN 24 /* 2026-09-05T18:42:16.325Z */
void iso_from_ms(int64_t ms, char out[ISO_LEN + 1]);
int iso_to_ms(const char *text, int64_t *out);

void sleep_ms(long ms);

/* ---- Varios ------------------------------------------------------------- */

int uuid4(char out[37]);
int mkdir_p(const char *path);
/* Escritura atómica: archivo temporal, fsync y rename. */
int write_file_atomic(const char *path, const char *data, size_t len);
/* Lee el archivo completo; agrega un '\0' final. NULL si falla. */
char *read_file(const char *path, size_t *len, size_t max_len);
uint64_t fnv1a64(const void *data, size_t len, uint64_t seed);
/* Copia acotada que siempre termina en '\0'. Devuelve -1 si se truncó. */
int copy_str(char *dst, size_t size, const char *src);

#endif
