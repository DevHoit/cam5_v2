/*
 * json.h — lector JSON mínimo (árbol en memoria) y constructor de texto.
 * Suficiente para la configuración remota y las respuestas de HoitLive Core;
 * evita depender de cJSON en el gateway.
 */
#ifndef CAM5_JSON_H
#define CAM5_JSON_H

#include "compat.h"

#include <stddef.h>
#include <stdint.h>

typedef enum { JSON_NULL, JSON_BOOL, JSON_NUMBER, JSON_STRING, JSON_ARRAY, JSON_OBJECT } json_type;

typedef struct json_node {
    json_type type;
    char *key;            /* nombre del miembro cuando el padre es un objeto */
    char *string;         /* JSON_STRING */
    double number;        /* JSON_NUMBER */
    int boolean;          /* JSON_BOOL */
    struct json_node *child;
    struct json_node *next;
} json_node;

json_node *json_parse(const char *text, size_t len, char *err, size_t err_len);
void json_free(json_node *node);

json_node *json_get(const json_node *object, const char *key);
size_t json_count(const json_node *array);
/* Acepta números y cadenas numéricas ("0.100000"), como entrega el portal. */
int json_number(const json_node *node, double *out);
double json_number_or(const json_node *node, double fallback);
const char *json_string_or(const json_node *node, const char *fallback);
int json_bool_or(const json_node *node, int fallback);
int json_is_null(const json_node *node);

/* ---- Constructor ----------------------------------------------------- */

typedef struct {
    char *data;
    size_t len;
    size_t cap;
    int failed;
} strbuf;

void sb_init(strbuf *sb);
void sb_free(strbuf *sb);
void sb_reset(strbuf *sb);
void sb_append(strbuf *sb, const char *data, size_t len);
void sb_puts(strbuf *sb, const char *text);
void sb_printf(strbuf *sb, const char *fmt, ...) CAM5_PRINTF(2, 3);
/* Agrega una cadena JSON entre comillas, con los caracteres escapados. */
void sb_json_string(strbuf *sb, const char *text);
/* Serializa el árbol en forma compacta y determinista. */
void json_write(strbuf *sb, const json_node *node);

#endif
