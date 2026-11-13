#include "compat.h"

#include "json.h"

#include <ctype.h>
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_DEPTH 64

typedef struct {
    const char *start;
    const char *p;
    const char *end;
    char *err;
    size_t err_len;
    int depth;
} parser;

static int fail(parser *ps, const char *msg)
{
    if (ps->err && ps->err_len && !ps->err[0])
        snprintf(ps->err, ps->err_len, "%s (posición %ld)", msg, (long) (ps->p - ps->start));
    return -1;
}

static void skip_ws(parser *ps)
{
    while (ps->p < ps->end && (*ps->p == ' ' || *ps->p == '\t' || *ps->p == '\n' || *ps->p == '\r'))
        ps->p++;
}

static json_node *node_new(json_type type)
{
    json_node *n = calloc(1, sizeof(*n));
    if (n)
        n->type = type;
    return n;
}

void json_free(json_node *node)
{
    while (node) {
        json_node *next = node->next;
        json_free(node->child);
        free(node->key);
        free(node->string);
        free(node);
        node = next;
    }
}

static int hex4(const char *p, unsigned *out)
{
    unsigned v = 0;
    for (int i = 0; i < 4; i++) {
        char c = p[i];
        v <<= 4;
        if (c >= '0' && c <= '9')
            v |= (unsigned) (c - '0');
        else if (c >= 'a' && c <= 'f')
            v |= (unsigned) (c - 'a' + 10);
        else if (c >= 'A' && c <= 'F')
            v |= (unsigned) (c - 'A' + 10);
        else
            return -1;
    }
    *out = v;
    return 0;
}

static size_t put_utf8(char *out, unsigned cp)
{
    if (cp < 0x80) {
        out[0] = (char) cp;
        return 1;
    }
    if (cp < 0x800) {
        out[0] = (char) (0xC0 | (cp >> 6));
        out[1] = (char) (0x80 | (cp & 0x3F));
        return 2;
    }
    if (cp < 0x10000) {
        out[0] = (char) (0xE0 | (cp >> 12));
        out[1] = (char) (0x80 | ((cp >> 6) & 0x3F));
        out[2] = (char) (0x80 | (cp & 0x3F));
        return 3;
    }
    out[0] = (char) (0xF0 | (cp >> 18));
    out[1] = (char) (0x80 | ((cp >> 12) & 0x3F));
    out[2] = (char) (0x80 | ((cp >> 6) & 0x3F));
    out[3] = (char) (0x80 | (cp & 0x3F));
    return 4;
}

static int parse_string(parser *ps, char **out)
{
    if (ps->p >= ps->end || *ps->p != '"')
        return fail(ps, "se esperaba una cadena");
    ps->p++;
    const char *start = ps->p;
    /* El resultado nunca es más largo que el texto de origen. */
    size_t max = 0;
    while (start + max < ps->end && start[max] != '"') {
        if (start[max] == '\\')
            max++;
        max++;
    }
    char *buf = malloc(max + 1);
    if (!buf)
        return fail(ps, "sin memoria");
    size_t n = 0;
    while (ps->p < ps->end && *ps->p != '"') {
        unsigned char c = (unsigned char) *ps->p++;
        if (c < 0x20) {
            free(buf);
            return fail(ps, "carácter de control en cadena");
        }
        if (c != '\\') {
            buf[n++] = (char) c;
            continue;
        }
        if (ps->p >= ps->end)
            break;
        char e = *ps->p++;
        switch (e) {
        case '"': buf[n++] = '"'; break;
        case '\\': buf[n++] = '\\'; break;
        case '/': buf[n++] = '/'; break;
        case 'b': buf[n++] = '\b'; break;
        case 'f': buf[n++] = '\f'; break;
        case 'n': buf[n++] = '\n'; break;
        case 'r': buf[n++] = '\r'; break;
        case 't': buf[n++] = '\t'; break;
        case 'u': {
            unsigned cp;
            if (ps->end - ps->p < 4 || hex4(ps->p, &cp) != 0) {
                free(buf);
                return fail(ps, "escape \\u inválido");
            }
            ps->p += 4;
            if (cp >= 0xD800 && cp <= 0xDBFF && ps->end - ps->p >= 6 && ps->p[0] == '\\' && ps->p[1] == 'u') {
                unsigned low;
                if (hex4(ps->p + 2, &low) == 0 && low >= 0xDC00 && low <= 0xDFFF) {
                    cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
                    ps->p += 6;
                }
            }
            if (cp >= 0xD800 && cp <= 0xDFFF)
                cp = 0xFFFD;
            /* \uXXXX ocupa 6 bytes de origen y como máximo 4 de salida. */
            n += put_utf8(buf + n, cp);
            break;
        }
        default:
            free(buf);
            return fail(ps, "escape inválido");
        }
    }
    if (ps->p >= ps->end) {
        free(buf);
        return fail(ps, "cadena sin cerrar");
    }
    ps->p++;
    buf[n] = '\0';
    *out = buf;
    return 0;
}

static json_node *parse_value(parser *ps);

static json_node *parse_container(parser *ps, int is_object)
{
    json_node *node = node_new(is_object ? JSON_OBJECT : JSON_ARRAY);
    if (!node) {
        fail(ps, "sin memoria");
        return NULL;
    }
    if (++ps->depth > MAX_DEPTH) {
        fail(ps, "anidamiento excesivo");
        json_free(node);
        return NULL;
    }
    ps->p++; /* '{' o '[' */
    json_node **tail = &node->child;
    skip_ws(ps);
    char close = is_object ? '}' : ']';
    if (ps->p < ps->end && *ps->p == close) {
        ps->p++;
        ps->depth--;
        return node;
    }
    for (;;) {
        char *key = NULL;
        skip_ws(ps);
        if (is_object) {
            if (parse_string(ps, &key) != 0)
                goto error;
            skip_ws(ps);
            if (ps->p >= ps->end || *ps->p != ':') {
                free(key);
                fail(ps, "se esperaba ':'");
                goto error;
            }
            ps->p++;
        }
        json_node *child = parse_value(ps);
        if (!child) {
            free(key);
            goto error;
        }
        child->key = key;
        *tail = child;
        tail = &child->next;
        skip_ws(ps);
        if (ps->p < ps->end && *ps->p == ',') {
            ps->p++;
            continue;
        }
        if (ps->p < ps->end && *ps->p == close) {
            ps->p++;
            ps->depth--;
            return node;
        }
        fail(ps, is_object ? "se esperaba ',' o '}'" : "se esperaba ',' o ']'");
        goto error;
    }
error:
    json_free(node);
    return NULL;
}

static json_node *parse_value(parser *ps)
{
    skip_ws(ps);
    if (ps->p >= ps->end) {
        fail(ps, "fin inesperado");
        return NULL;
    }
    char c = *ps->p;
    if (c == '{' || c == '[')
        return parse_container(ps, c == '{');
    if (c == '"') {
        json_node *n = node_new(JSON_STRING);
        if (!n || parse_string(ps, &n->string) != 0) {
            json_free(n);
            return NULL;
        }
        return n;
    }
    size_t left = (size_t) (ps->end - ps->p);
    if (left >= 4 && !memcmp(ps->p, "true", 4)) {
        ps->p += 4;
        json_node *n = node_new(JSON_BOOL);
        if (n)
            n->boolean = 1;
        return n;
    }
    if (left >= 5 && !memcmp(ps->p, "false", 5)) {
        ps->p += 5;
        return node_new(JSON_BOOL);
    }
    if (left >= 4 && !memcmp(ps->p, "null", 4)) {
        ps->p += 4;
        return node_new(JSON_NULL);
    }
    if (c == '-' || (c >= '0' && c <= '9')) {
        char tmp[64];
        size_t n = 0;
        while (ps->p + n < ps->end && n < sizeof(tmp) - 1 && strchr("+-0123456789.eE", ps->p[n]))
            n++;
        memcpy(tmp, ps->p, n);
        tmp[n] = '\0';
        char *endp;
        double v = strtod(tmp, &endp);
        if (endp != tmp + n || n == 0) {
            fail(ps, "número inválido");
            return NULL;
        }
        ps->p += n;
        json_node *node = node_new(JSON_NUMBER);
        if (node)
            node->number = v;
        return node;
    }
    fail(ps, "valor inesperado");
    return NULL;
}

json_node *json_parse(const char *text, size_t len, char *err, size_t err_len)
{
    parser ps = { text, text, text + len, err, err_len, 0 };
    if (err && err_len)
        err[0] = '\0';
    json_node *root = parse_value(&ps);
    if (!root)
        return NULL;
    skip_ws(&ps);
    if (ps.p != ps.end) {
        fail(&ps, "contenido sobrante después del JSON");
        json_free(root);
        return NULL;
    }
    return root;
}

json_node *json_get(const json_node *object, const char *key)
{
    if (!object || object->type != JSON_OBJECT)
        return NULL;
    for (json_node *c = object->child; c; c = c->next)
        if (c->key && !strcmp(c->key, key))
            return c;
    return NULL;
}

size_t json_count(const json_node *array)
{
    size_t n = 0;
    if (array && (array->type == JSON_ARRAY || array->type == JSON_OBJECT))
        for (json_node *c = array->child; c; c = c->next)
            n++;
    return n;
}

int json_number(const json_node *node, double *out)
{
    if (!node)
        return -1;
    if (node->type == JSON_NUMBER) {
        *out = node->number;
        return 0;
    }
    if (node->type == JSON_STRING && node->string[0]) {
        char *endp;
        double v = strtod(node->string, &endp);
        if (*endp == '\0' && isfinite(v)) {
            *out = v;
            return 0;
        }
    }
    return -1;
}

double json_number_or(const json_node *node, double fallback)
{
    double v;
    return json_number(node, &v) == 0 ? v : fallback;
}

const char *json_string_or(const json_node *node, const char *fallback)
{
    return node && node->type == JSON_STRING ? node->string : fallback;
}

int json_bool_or(const json_node *node, int fallback)
{
    return node && node->type == JSON_BOOL ? node->boolean : fallback;
}

int json_is_null(const json_node *node) { return !node || node->type == JSON_NULL; }

/* ---- Constructor ----------------------------------------------------- */

void sb_init(strbuf *sb) { memset(sb, 0, sizeof(*sb)); }

void sb_free(strbuf *sb)
{
    free(sb->data);
    sb_init(sb);
}

void sb_reset(strbuf *sb)
{
    sb->len = 0;
    sb->failed = 0;
    if (sb->data)
        sb->data[0] = '\0';
}

static int sb_reserve(strbuf *sb, size_t extra)
{
    if (sb->failed)
        return -1;
    if (sb->len + extra + 1 <= sb->cap)
        return 0;
    size_t cap = sb->cap ? sb->cap : 256;
    while (cap < sb->len + extra + 1)
        cap *= 2;
    char *grown = realloc(sb->data, cap);
    if (!grown) {
        sb->failed = 1;
        return -1;
    }
    sb->data = grown;
    sb->cap = cap;
    return 0;
}

void sb_append(strbuf *sb, const char *data, size_t len)
{
    if (sb_reserve(sb, len) != 0)
        return;
    memcpy(sb->data + sb->len, data, len);
    sb->len += len;
    sb->data[sb->len] = '\0';
}

void sb_puts(strbuf *sb, const char *text) { sb_append(sb, text, strlen(text)); }

void sb_printf(strbuf *sb, const char *fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    char small[256];
    int n = vsnprintf(small, sizeof(small), fmt, ap);
    va_end(ap);
    if (n < 0) {
        sb->failed = 1;
        return;
    }
    if ((size_t) n < sizeof(small)) {
        sb_append(sb, small, (size_t) n);
        return;
    }
    if (sb_reserve(sb, (size_t) n) != 0)
        return;
    va_start(ap, fmt);
    vsnprintf(sb->data + sb->len, (size_t) n + 1, fmt, ap);
    va_end(ap);
    sb->len += (size_t) n;
}

void sb_json_string(strbuf *sb, const char *text)
{
    sb_append(sb, "\"", 1);
    for (const unsigned char *p = (const unsigned char *) (text ? text : ""); *p; p++) {
        switch (*p) {
        case '"': sb_append(sb, "\\\"", 2); break;
        case '\\': sb_append(sb, "\\\\", 2); break;
        case '\n': sb_append(sb, "\\n", 2); break;
        case '\r': sb_append(sb, "\\r", 2); break;
        case '\t': sb_append(sb, "\\t", 2); break;
        default:
            if (*p < 0x20)
                sb_printf(sb, "\\u%04x", *p);
            else
                sb_append(sb, (const char *) p, 1);
        }
    }
    sb_append(sb, "\"", 1);
}

void json_write(strbuf *sb, const json_node *node)
{
    if (!node) {
        sb_puts(sb, "null");
        return;
    }
    switch (node->type) {
    case JSON_NULL: sb_puts(sb, "null"); break;
    case JSON_BOOL: sb_puts(sb, node->boolean ? "true" : "false"); break;
    case JSON_NUMBER: sb_printf(sb, "%.17g", node->number); break;
    case JSON_STRING: sb_json_string(sb, node->string); break;
    case JSON_ARRAY:
    case JSON_OBJECT: {
        int obj = node->type == JSON_OBJECT;
        sb_append(sb, obj ? "{" : "[", 1);
        for (json_node *c = node->child; c; c = c->next) {
            if (c != node->child)
                sb_append(sb, ",", 1);
            if (obj) {
                sb_json_string(sb, c->key);
                sb_append(sb, ":", 1);
            }
            json_write(sb, c);
        }
        sb_append(sb, obj ? "}" : "]", 1);
        break;
    }
    }
}
