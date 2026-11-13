/*
 * cam5-gateway — gateway HoitLive Core para controladores IntelliSAW CAM-5.
 *
 * Versión en C del gateway de referencia gateway/cam5_gateway.py, para equipos
 * sin Python como el módulo SIMCom SIM7600SA-H con OpenLinux. Implementa el
 * mismo contrato (gateway/CAM5_GATEWAY_PROTOCOL.md):
 *
 *   CAM-5 ──Modbus TCP──▶ cam5-gateway ──HTTPS──▶ core.hoitlive.com/api/v1
 *                              │
 *                       cola en flash (lotes pendientes)
 *
 * Variables de entorno (las mismas del gateway Python, más las propias de C):
 *   CAM5_API_BASE          URL base, p. ej. https://core.hoitlive.com/api/v1 (obligatoria)
 *   CAM5_GATEWAY_TOKEN     token del gateway (obligatorio)
 *   CAM5_STATE_DIR         configuración local y cola (por defecto /data/cam5-gateway)
 *   CAM5_HOST_OVERRIDES    CAM5-CTRL-01=192.168.1.50:502,… para otra IP/puerto
 *   CAM5_REGISTER_OFFSET   desplazamiento de dirección Modbus (0)
 *   CAM5_MAX_READ          registros por lectura (81, límite del CAM-5)
 *   CAM5_RUN_ONCE          1 para un ciclo completo y salir
 *   CAM5_LOG_LEVEL         DEBUG, INFO, WARNING
 *   CAM5_LOG_FILE          archivo de registro con rotación (por defecto, salida estándar)
 *   CAM5_CA_FILE           certificados raíz PEM para validar el portal
 *   CAM5_HTTP_TIMEOUT      segundos por solicitud HTTP (20)
 *   CAM5_QUEUE_MAX_MB      tope de la cola en flash (16)
 *   CAM5_HEARTBEAT_IDLE_S  segundos sin contacto antes de enviar heartbeat (intervalo del portal)
 *   CAM5_TLS_GROUPS        intercambio de claves TLS (X25519:P-256)
 */
#include "compat.h"

#include "http.h"
#include "json.h"
#include "modbus.h"
#include "queue.h"
#include "util.h"

#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <unistd.h>

#define CONFIG_REFRESH_SECONDS (15 * 60)
#define CONFIG_RETRY_SECONDS 30
#define QUEUE_MAX_AGE_MS (INT64_C(7) * 24 * 3600 * 1000 - INT64_C(10) * 60 * 1000)
#define MAX_FLUSH_PER_LOOP 5
#define STATE_UPLOAD_MIN_GAP 30.0
#define LOOP_SLEEP_MS 200
#define STATS_INTERVAL_SECONDS (15 * 60)
#define MAX_BATCH_REGISTERS 105 /* límite del portal por lote */
#define UINT16_ERROR 0xFFFF
#define DATA_VERSION_REGISTER 454
#define LATENCY_WINDOW 20

static const int RETRY_DELAYS[] = { 2, 5, 15, 30, 60 };
static const int RECONNECT_DELAYS[] = { 5, 10, 30, 60 };
#define COUNT(a) ((int) (sizeof(a) / sizeof((a)[0])))

/* Prefijo fijo de cada lote: permite actualizar sentAt al reenviar sin
 * volver a serializar el lote guardado. */
static const char PAYLOAD_PREFIX[] = "{\"schemaVersion\":\"1.0\",\"sentAt\":\"";

/* ---- Estructuras -------------------------------------------------------- */

typedef struct {
    char name[96];
    int start, end, function;
    double interval_s;
    double next_poll;
} range_def;

typedef struct {
    int reg;
    int is_int16;
    double scale;
    int has_error_raw;
    int error_raw;
} register_def;

typedef struct {
    int reg;
    int has_warning, has_critical;
    double warning, critical;
} channel_def;

typedef struct {
    int valid;
    uint16_t raw;
    int64_t started_ms;
    int64_t recorded_ms;
} cache_entry;

typedef struct {
    char code[64];
    modbus_client mb;
    range_def *ranges;
    int nranges;
    register_def *defs;
    int ndefs;
    channel_def *channels;
    int nchannels;
    int *operational;
    int noperational;
    int *diagnostic;
    int ndiagnostic;
    double storage_s;
    double diagnostic_s;
    cache_entry *cache;
    int cache_base;
    int cache_len;
    double next_storage;
    double next_diagnostic;
    char *sent_states; /* estado de alarma por canal en el último envío */
    char *states;
    int have_states;
    double last_state_upload;
    int failing;
    modbus_error failure;
    int failure_count;
    double next_reconnect;
    double next_error_report;
    int latencies[LATENCY_WINDOW];
    int nlatencies;
    int latency_pos;
} device;

typedef struct {
    char code[64];
    char target[128];
} host_override;

typedef struct {
    char api_base[512];
    char token[512];
    char state_dir[512];
    char ca_file[512];
    char log_file[512];
    host_override overrides[32];
    int noverrides;
    int register_offset;
    int max_read;
    int run_once;
    int http_timeout;
    int heartbeat_idle_s;
    uint64_t queue_max_bytes;
} settings;

typedef struct {
    settings cfg;
    http_client http;
    batch_queue queue;
    char boot_id[37];
    double started;
    unsigned long sequence;
    char code[64];
    device *devices;
    int ndevices;
    int have_config;
    uint64_t config_signature;
    char etag[160];
    double next_config;
    double next_heartbeat;
    double heartbeat_s;
    double last_contact;
    int retry_index;
    double next_attempt;
    double next_stats;
    int warned_clock;
} gateway;

static volatile sig_atomic_t g_running = 1;
static volatile sig_atomic_t g_dump_stats = 0;

static void on_signal(int sig)
{
    if (sig == SIGUSR1)
        g_dump_stats = 1; /* kill -USR1: registra el estado sin detener */
    else
        g_running = 0;
}

/* ---- Configuración local ------------------------------------------------ */

static const char *env_or(const char *name, const char *fallback)
{
    const char *v = getenv(name);
    return v && *v ? v : fallback;
}

static int env_int(const char *name, int fallback, int min, int max)
{
    const char *v = getenv(name);
    if (!v || !*v)
        return fallback;
    char *end;
    long n = strtol(v, &end, 10);
    if (*end || n < min || n > max) {
        fprintf(stderr, "%s debe ser un entero entre %d y %d (recibido «%s»)\n", name, min, max, v);
        exit(2);
    }
    return (int) n;
}

static int truthy(const char *v)
{
    return v && (!strcasecmp(v, "1") || !strcasecmp(v, "true") || !strcasecmp(v, "yes"));
}

/* Carga KEY=VALUE de un archivo .env sin pisar variables ya definidas. */
static int load_env_file(const char *path)
{
    size_t len;
    char *text = read_file(path, &len, 64 * 1024);
    if (!text) {
        fprintf(stderr, "No se pudo leer %s: %s\n", path, strerror(errno));
        return -1;
    }
    char *save = NULL;
    for (char *line = strtok_r(text, "\n", &save); line; line = strtok_r(NULL, "\n", &save)) {
        while (*line == ' ' || *line == '\t')
            line++;
        if (!strncmp(line, "export ", 7))
            line += 7;
        if (*line == '#' || !*line)
            continue;
        char *eq = strchr(line, '=');
        if (!eq)
            continue;
        *eq = '\0';
        char *key = line, *value = eq + 1;
        size_t kl = strlen(key);
        while (kl && (key[kl - 1] == ' ' || key[kl - 1] == '\t'))
            key[--kl] = '\0';
        size_t vl = strlen(value);
        while (vl && (value[vl - 1] == '\r' || value[vl - 1] == ' ' || value[vl - 1] == '\t'))
            value[--vl] = '\0';
        if (vl >= 2 && ((value[0] == '"' && value[vl - 1] == '"') || (value[0] == '\'' && value[vl - 1] == '\''))) {
            value[vl - 1] = '\0';
            value++;
        }
        if (*key)
            setenv(key, value, 0);
    }
    free(text);
    return 0;
}

static int parse_overrides(settings *s, const char *value)
{
    if (!value || !*value)
        return 0;
    char buf[2048];
    if (copy_str(buf, sizeof(buf), value) != 0)
        return -1;
    char *save = NULL;
    for (char *item = strtok_r(buf, ",", &save); item; item = strtok_r(NULL, ",", &save)) {
        while (*item == ' ')
            item++;
        char *eq = strchr(item, '=');
        if (!eq || eq == item || !eq[1] || s->noverrides >= COUNT(s->overrides)) {
            fprintf(stderr, "CAM5_HOST_OVERRIDES: entrada inválida «%s»; usa CODIGO=ip:puerto\n", item);
            return -1;
        }
        *eq = '\0';
        host_override *o = &s->overrides[s->noverrides++];
        copy_str(o->code, sizeof(o->code), item);
        copy_str(o->target, sizeof(o->target), eq + 1);
        for (char *c = o->code; *c; c++)
            if (*c >= 'a' && *c <= 'z')
                *c = (char) (*c - 'a' + 'A');
    }
    return 0;
}

static int is_local_host(const char *url)
{
    const char *p = strstr(url, "://");
    p = p ? p + 3 : url;
    return !strncmp(p, "localhost", 9) || !strncmp(p, "127.", 4) || !strncmp(p, "[::1]", 5);
}

static int load_settings(settings *s)
{
    memset(s, 0, sizeof(*s));
    copy_str(s->api_base, sizeof(s->api_base), env_or("CAM5_API_BASE", ""));
    copy_str(s->token, sizeof(s->token), env_or("CAM5_GATEWAY_TOKEN", ""));
    if (!s->api_base[0] || !s->token[0]) {
        fprintf(stderr, "Configura CAM5_API_BASE y CAM5_GATEWAY_TOKEN antes de iniciar.\n");
        return -1;
    }
    if (!strncasecmp(s->api_base, "http://", 7) && !is_local_host(s->api_base) && !truthy(getenv("CAM5_ALLOW_INSECURE_HTTP"))) {
        fprintf(stderr, "CAM5_API_BASE usa http:// sin cifrar; el token viajaría en claro. Usa https://.\n");
        return -1;
    }
    copy_str(s->state_dir, sizeof(s->state_dir), env_or("CAM5_STATE_DIR", "/data/cam5-gateway"));
    copy_str(s->ca_file, sizeof(s->ca_file), env_or("CAM5_CA_FILE", ""));
    copy_str(s->log_file, sizeof(s->log_file), env_or("CAM5_LOG_FILE", ""));
    if (parse_overrides(s, getenv("CAM5_HOST_OVERRIDES")) != 0)
        return -1;
    s->register_offset = env_int("CAM5_REGISTER_OFFSET", 0, -65535, 65535);
    s->max_read = env_int("CAM5_MAX_READ", 81, 1, 125);
    s->run_once = truthy(getenv("CAM5_RUN_ONCE"));
    s->http_timeout = env_int("CAM5_HTTP_TIMEOUT", 20, 3, 120);
    s->heartbeat_idle_s = env_int("CAM5_HEARTBEAT_IDLE_S", 0, 0, 170);
    s->queue_max_bytes = (uint64_t) env_int("CAM5_QUEUE_MAX_MB", 16, 1, 4096) * 1024 * 1024;
    return 0;
}

/* ---- Controladores ------------------------------------------------------ */

static void device_free(device *d)
{
    modbus_close(&d->mb);
    free(d->ranges);
    free(d->defs);
    free(d->channels);
    free(d->operational);
    free(d->diagnostic);
    free(d->cache);
    free(d->sent_states);
    free(d->states);
    memset(d, 0, sizeof(*d));
}

static int compare_int(const void *a, const void *b)
{
    int x = *(const int *) a, y = *(const int *) b;
    return (x > y) - (x < y);
}

static int compare_def(const void *a, const void *b)
{
    return compare_int(&((const register_def *) a)->reg, &((const register_def *) b)->reg);
}

static const register_def *find_def(const device *d, int reg)
{
    register_def key = { reg, 0, 0, 0, 0 };
    return bsearch(&key, d->defs, (size_t) d->ndefs, sizeof(register_def), compare_def);
}

static cache_entry *cache_at(device *d, int reg)
{
    if (reg < d->cache_base || reg >= d->cache_base + d->cache_len)
        return NULL;
    return &d->cache[reg - d->cache_base];
}

static int number_field(const json_node *obj, const char *key, int fallback)
{
    double v;
    return json_number(json_get(obj, key), &v) == 0 ? (int) v : fallback;
}

static int device_from_json(device *d, const json_node *node, const settings *s)
{
    memset(d, 0, sizeof(*d));
    const char *code = json_string_or(json_get(node, "code"), NULL);
    if (!code || copy_str(d->code, sizeof(d->code), code) != 0) {
        LOGW("Controlador sin código válido en la configuración; se omite");
        return -1;
    }
    char host[128];
    copy_str(host, sizeof(host), json_string_or(json_get(node, "host"), ""));
    int port = number_field(node, "port", 502);
    for (int i = 0; i < s->noverrides; i++) {
        if (strcasecmp(s->overrides[i].code, d->code) != 0)
            continue;
        char target[128];
        copy_str(target, sizeof(target), s->overrides[i].target);
        char *colon = strrchr(target, ':');
        if (colon && !strchr(colon, ']')) {
            *colon = '\0';
            port = atoi(colon + 1);
        }
        copy_str(host, sizeof(host), target[0] == '[' ? target + 1 : target);
        size_t hl = strlen(host);
        if (hl && host[hl - 1] == ']')
            host[hl - 1] = '\0';
    }
    if (!host[0]) {
        LOGW("%s no tiene IP registrada en el portal; se omite", d->code);
        return -1;
    }
    int unit = number_field(node, "unitId", 1);
    if (unit < 1 || unit > 247 || port < 1 || port > 65535) {
        LOGW("%s tiene Unit ID o puerto inválido; se omite", d->code);
        return -1;
    }
    double timeout = json_number_or(json_get(node, "timeoutMs"), 1000);
    double retries = json_number_or(json_get(node, "retries"), 2);
    modbus_init(&d->mb, host, port, unit, (int) timeout, (int) retries, s->max_read);

    const json_node *policy = json_get(node, "uploadPolicy");
    d->storage_s = json_number_or(json_get(policy, "normalIntervalMs"), 60000) / 1000.0;
    d->diagnostic_s = json_number_or(json_get(policy, "diagnosticIntervalMs"), 300000) / 1000.0;
    if (d->storage_s < 1)
        d->storage_s = 60;
    if (d->diagnostic_s < 1)
        d->diagnostic_s = 300;

    /* Rangos de lectura */
    const json_node *ranges = json_get(node, "ranges");
    d->ranges = calloc(json_count(ranges) + 1, sizeof(range_def));
    int min_reg = 65536, max_reg = -1;
    for (const json_node *r = ranges ? ranges->child : NULL; r; r = r->next) {
        if (!json_bool_or(json_get(r, "enabled"), 1))
            continue;
        if (d->nranges >= 64) {
            LOGW("%s: más de 64 rangos de lectura; se ignoran los restantes", d->code);
            break;
        }
        range_def *rd = &d->ranges[d->nranges];
        rd->function = number_field(r, "functionCode", 3);
        rd->start = number_field(r, "startRegister", -1);
        rd->end = number_field(r, "endRegister", -1);
        rd->interval_s = json_number_or(json_get(r, "intervalMs"), 60000) / 1000.0;
        copy_str(rd->name, sizeof(rd->name), json_string_or(json_get(r, "name"), "rango"));
        if (rd->function != 3 && rd->function != 4) {
            LOGW("%s: el rango «%s» usa la función %d; solo se permiten lecturas (3 y 4)", d->code, rd->name, rd->function);
            continue;
        }
        if (rd->start < 0 || rd->end < rd->start || rd->end > 65535 || rd->end - rd->start >= 1024) {
            LOGW("%s: el rango «%s» (%d–%d) no es válido; se omite", d->code, rd->name, rd->start, rd->end);
            continue;
        }
        if (rd->interval_s < 0.5)
            rd->interval_s = 0.5;
        if (rd->start < min_reg)
            min_reg = rd->start;
        if (rd->end > max_reg)
            max_reg = rd->end;
        d->nranges++;
    }
    if (d->nranges > 0) {
        d->cache_base = min_reg;
        d->cache_len = max_reg - min_reg + 1;
        d->cache = calloc((size_t) d->cache_len, sizeof(cache_entry));
    }

    /* Catálogo de registros */
    const json_node *regs = json_get(node, "registers");
    d->defs = calloc(json_count(regs) + 1, sizeof(register_def));
    for (const json_node *r = regs ? regs->child : NULL; r; r = r->next) {
        register_def *def = &d->defs[d->ndefs];
        def->reg = number_field(r, "register", -1);
        if (def->reg < 0 || def->reg > 65535)
            continue;
        def->is_int16 = !strcmp(json_string_or(json_get(r, "dataType"), "uint16"), "int16");
        def->scale = json_number_or(json_get(r, "scaleFactor"), 1);
        if (def->scale == 0)
            def->scale = 1;
        double err_raw;
        def->has_error_raw = json_number(json_get(r, "errorRawValue"), &err_raw) == 0;
        def->error_raw = def->has_error_raw ? (int) err_raw : 0;
        d->ndefs++;
    }
    qsort(d->defs, (size_t) d->ndefs, sizeof(register_def), compare_def);

    /* Canales habilitados y umbrales */
    const json_node *chans = json_get(node, "channels");
    d->channels = calloc(json_count(chans) + 1, sizeof(channel_def));
    d->operational = calloc(json_count(chans) + 1, sizeof(int));
    for (const json_node *c = chans ? chans->child : NULL; c; c = c->next) {
        if (!json_bool_or(json_get(c, "enabled"), 1))
            continue;
        channel_def *ch = &d->channels[d->nchannels];
        ch->reg = number_field(c, "register", -1);
        ch->has_warning = json_number(json_get(c, "warningThreshold"), &ch->warning) == 0;
        ch->has_critical = json_number(json_get(c, "criticalThreshold"), &ch->critical) == 0;
        d->nchannels++;
        if (find_def(d, ch->reg))
            d->operational[d->noperational++] = ch->reg;
    }
    qsort(d->operational, (size_t) d->noperational, sizeof(int), compare_int);
    int unique = 0;
    for (int i = 0; i < d->noperational; i++)
        if (i == 0 || d->operational[i] != d->operational[unique - 1])
            d->operational[unique++] = d->operational[i];
    d->noperational = unique;

    d->diagnostic = calloc((size_t) d->ndefs + 1, sizeof(int));
    for (int i = 0; i < d->ndefs; i++)
        if (i == 0 || d->defs[i].reg != d->defs[i - 1].reg)
            d->diagnostic[d->ndiagnostic++] = d->defs[i].reg;

    d->sent_states = calloc((size_t) d->nchannels + 1, 1);
    d->states = calloc((size_t) d->nchannels + 1, 1);
    if (!d->ranges || !d->defs || !d->channels || !d->operational || !d->diagnostic || !d->sent_states || !d->states || (d->nranges && !d->cache)) {
        LOGE("%s: sin memoria para la configuración", d->code);
        device_free(d);
        return -1;
    }
    double now = mono_now();
    d->next_diagnostic = now + (d->diagnostic_s < 30 ? d->diagnostic_s : 30);
    LOGI("Controlador %s → %s:%d Unit %d (%d canales operativos, %d rangos)",
         d->code, d->mb.host, d->mb.port, d->mb.unit_id, d->noperational, d->nranges);
    return 0;
}

/* ---- Lotes -------------------------------------------------------------- */

static unsigned long next_sequence(gateway *gw) { return ++gw->sequence; }

static long uptime_seconds(const gateway *gw) { return (long) (mono_now() - gw->started); }

static void begin_payload(gateway *gw, device *d, strbuf *sb, const char *trigger, unsigned long seq)
{
    char now[ISO_LEN + 1];
    iso_from_ms(wall_ms(), now);
    sb_puts(sb, PAYLOAD_PREFIX);
    sb_puts(sb, now);
    sb_puts(sb, "\",\"trigger\":");
    sb_json_string(sb, trigger);
    sb_puts(sb, ",\"batchKey\":");
    char key[200];
    snprintf(key, sizeof(key), "%s:%s:%s:%lu", gw->boot_id, d->code, trigger, seq);
    sb_json_string(sb, key);
    sb_puts(sb, ",\"gateway\":{\"code\":");
    sb_json_string(sb, gw->code);
    sb_puts(sb, ",\"bootId\":");
    sb_json_string(sb, gw->boot_id);
    sb_printf(sb, ",\"sequence\":%lu,\"uptimeSeconds\":%ld},\"device\":{\"code\":", seq, uptime_seconds(gw));
    sb_json_string(sb, d->code);
    sb_printf(sb, ",\"unitId\":%d", d->mb.unit_id);
    cache_entry *version = cache_at(d, DATA_VERSION_REGISTER);
    if (version && version->valid && version->raw != UINT16_ERROR)
        sb_printf(sb, ",\"dataVersion\":%u", (unsigned) version->raw);
    sb_puts(sb, "}");
}

static void poll_section(device *d, strbuf *sb, int64_t started, int64_t completed, int expected, const modbus_error *error)
{
    char a[ISO_LEN + 1], b[ISO_LEN + 1];
    iso_from_ms(started, a);
    iso_from_ms(completed > started ? completed : started, b);
    sb_printf(sb, ",\"poll\":{\"startedAt\":\"%s\",\"completedAt\":\"%s\",\"expectedRegisters\":%d", a, b, expected > 0 ? expected : 1);
    if (d->nlatencies > 0) {
        long sum = 0;
        for (int i = 0; i < d->nlatencies; i++)
            sum += d->latencies[i];
        sb_printf(sb, ",\"latencyMs\":%ld", sum / d->nlatencies);
    }
    if (error) {
        sb_puts(sb, ",\"error\":{\"code\":");
        sb_json_string(sb, error->code);
        sb_puts(sb, ",\"message\":");
        sb_json_string(sb, error->message);
        sb_puts(sb, "}");
    }
    sb_puts(sb, "}");
}

static int enqueue(gateway *gw, strbuf *sb, unsigned long seq, int64_t completed)
{
    if (sb->failed) {
        LOGE("Sin memoria para armar el lote %lu", seq);
        return -1;
    }
    return queue_put(&gw->queue, sb->data, sb->len, seq, completed);
}

/*
 * Lote con los registros indicados que estén en la memoria de lecturas.
 * Solo se envía lo indispensable: sequence, quality y flags toman los
 * valores por omisión del portal, y recordedAt solo aparece cuando difiere
 * de poll.completedAt. Reduce el consumo 4G sin cambiar lo que se guarda.
 */
static int enqueue_batch(gateway *gw, device *d, const char *trigger, const int *regs, int nregs)
{
    int64_t started = INT64_MAX, completed = 0;
    int selected = 0;
    for (int i = 0; i < nregs; i++) {
        cache_entry *e = cache_at(d, regs[i]);
        if (!e || !e->valid)
            continue;
        if (selected >= MAX_BATCH_REGISTERS) {
            LOGW("%s: el lote %s supera %d registros; se recorta", d->code, trigger, MAX_BATCH_REGISTERS);
            break;
        }
        selected++;
        if (e->started_ms < started)
            started = e->started_ms;
        if (e->recorded_ms > completed)
            completed = e->recorded_ms;
    }
    if (!selected)
        return 0;

    unsigned long seq = next_sequence(gw);
    strbuf sb;
    sb_init(&sb);
    begin_payload(gw, d, &sb, trigger, seq);
    poll_section(d, &sb, started, completed, selected, NULL);
    sb_puts(&sb, ",\"readings\":[");
    int written = 0;
    for (int i = 0; i < nregs && written < selected; i++) {
        cache_entry *e = cache_at(d, regs[i]);
        if (!e || !e->valid)
            continue;
        sb_printf(&sb, "%s{\"register\":%d,\"rawValue\":%u", written ? "," : "", regs[i], (unsigned) e->raw);
        if (e->recorded_ms != completed) {
            char at[ISO_LEN + 1];
            iso_from_ms(e->recorded_ms, at);
            sb_printf(&sb, ",\"recordedAt\":\"%s\"", at);
        }
        sb_puts(&sb, "}");
        written++;
    }
    sb_puts(&sb, "]}");
    int rc = enqueue(gw, &sb, seq, completed);
    LOGD("Lote %s de %s: %d registro(s), %lu B", trigger, d->code, selected, (unsigned long) sb.len);
    sb_free(&sb);
    return rc;
}

static void enqueue_error(gateway *gw, device *d, const range_def *range, int64_t started, const modbus_error *error)
{
    unsigned long seq = next_sequence(gw);
    int64_t completed = wall_ms();
    strbuf sb;
    sb_init(&sb);
    begin_payload(gw, d, &sb, "error", seq);
    poll_section(d, &sb, started, completed, range->end - range->start + 1, error);
    sb_puts(&sb, ",\"readings\":[]}");
    enqueue(gw, &sb, seq, completed);
    sb_free(&sb);
}

/* ---- Ciclo de lectura --------------------------------------------------- */

static void register_failure(gateway *gw, device *d, const range_def *range, const modbus_error *error, int64_t started)
{
    int first = !d->failing;
    double now = mono_now();
    d->failing = 1;
    d->failure = *error;
    d->failure_count++;
    int idx = d->failure_count - 1 < COUNT(RECONNECT_DELAYS) ? d->failure_count - 1 : COUNT(RECONNECT_DELAYS) - 1;
    d->next_reconnect = now + RECONNECT_DELAYS[idx];
    if (first)
        LOGW("%s sin comunicación: %s (%s); reintento cada %d–%d s", d->code, error->message, range->name,
             RECONNECT_DELAYS[0], RECONNECT_DELAYS[COUNT(RECONNECT_DELAYS) - 1]);
    else
        LOGD("%s sigue sin responder (intento %d): %s", d->code, d->failure_count, error->message);
    if (!first && now < d->next_error_report)
        return;
    d->next_error_report = now + d->storage_s;
    if (clock_trusted())
        enqueue_error(gw, d, range, started, error);
}

static void device_poll(gateway *gw, device *d, double now)
{
    if (d->failing && now < d->next_reconnect)
        return; /* no bloquear al resto de los equipos con timeouts repetidos */
    int read_ranges[64];
    int nread = 0;
    for (int i = 0; i < d->nranges; i++) {
        range_def *r = &d->ranges[i];
        if (now < r->next_poll)
            continue;
        r->next_poll = now + r->interval_s;
        int count = r->end - r->start + 1;
        uint16_t values[1024];
        int64_t started = wall_ms();
        double began = mono_now();
        modbus_error error;
        memset(&error, 0, sizeof(error));
        if (modbus_read(&d->mb, r->function, r->start, count, gw->cfg.register_offset, values, &error) != 0) {
            register_failure(gw, d, r, &error, started);
            break;
        }
        d->latencies[d->latency_pos] = (int) ((mono_now() - began) * 1000);
        d->latency_pos = (d->latency_pos + 1) % LATENCY_WINDOW;
        if (d->nlatencies < LATENCY_WINDOW)
            d->nlatencies++;
        for (int k = 0; k < count; k++) {
            cache_entry *e = cache_at(d, r->start + k);
            e->valid = 1;
            e->raw = values[k];
            e->started_ms = started;
        }
        if (nread < (int) (sizeof(read_ranges) / sizeof(read_ranges[0])))
            read_ranges[nread++] = i;
        if (d->failing) {
            LOGI("%s volvió a responder después de %d intento(s) fallido(s)", d->code, d->failure_count);
            d->failing = 0;
            d->failure_count = 0;
        }
    }
    /* Los rangos de un mismo ciclo comparten la hora de término (difieren en
     * milisegundos): así el lote omite recordedAt por lectura. */
    int64_t completed = wall_ms();
    for (int j = 0; j < nread; j++) {
        const range_def *r = &d->ranges[read_ranges[j]];
        for (int reg = r->start; reg <= r->end; reg++)
            cache_at(d, reg)->recorded_ms = completed;
    }
}

/* n: normal, w: advertencia, c: crítico, u: sin dato, 0: sin lectura todavía */
static void compute_states(device *d)
{
    for (int i = 0; i < d->nchannels; i++) {
        const channel_def *ch = &d->channels[i];
        cache_entry *e = cache_at(d, ch->reg);
        const register_def *def = find_def(d, ch->reg);
        if (!e || !e->valid || !def) {
            d->states[i] = 0;
            continue;
        }
        if (def->has_error_raw && e->raw == def->error_raw) {
            d->states[i] = 'u';
            continue;
        }
        double raw = e->raw;
        if (def->is_int16 && e->raw >= 0x8000)
            raw -= 65536.0;
        double value = raw * def->scale;
        d->states[i] = ch->has_critical && value >= ch->critical ? 'c'
                     : ch->has_warning && value >= ch->warning   ? 'w'
                                                                 : 'n';
    }
}

static void device_due(gateway *gw, device *d, double now)
{
    if (d->failing || !d->nranges)
        return;
    int any = 0;
    for (int i = 0; i < d->cache_len && !any; i++)
        any = d->cache[i].valid;
    if (!any)
        return;
    if (!clock_trusted()) {
        if (!gw->warned_clock)
            LOGW("La hora del sistema no está sincronizada; los lotes esperan a conocer la hora del portal");
        gw->warned_clock = 1;
        return;
    }

    compute_states(d);
    if (!d->have_states) {
        memcpy(d->sent_states, d->states, (size_t) d->nchannels);
        d->have_states = 1;
    }
    int changed = memcmp(d->states, d->sent_states, (size_t) d->nchannels) != 0;
    if (changed && now - d->last_state_upload >= STATE_UPLOAD_MIN_GAP) {
        int alarm = 0;
        for (int i = 0; i < d->nchannels; i++)
            if (d->states[i] && d->states[i] != 'n')
                alarm = 1;
        d->last_state_upload = now;
        d->next_storage = now + d->storage_s; /* el portal difiere envíos programados muy seguidos */
        memcpy(d->sent_states, d->states, (size_t) d->nchannels);
        enqueue_batch(gw, d, alarm ? "alarm" : "recovery", d->operational, d->noperational);
        return;
    }
    if (now >= d->next_diagnostic) {
        d->next_diagnostic = now + d->diagnostic_s;
        enqueue_batch(gw, d, "diagnostic", d->diagnostic, d->ndiagnostic);
        return;
    }
    if (now >= d->next_storage && d->noperational) {
        d->next_storage = now + d->storage_s;
        memcpy(d->sent_states, d->states, (size_t) d->nchannels);
        enqueue_batch(gw, d, "scheduled", d->operational, d->noperational);
    }
}

/* ---- API ---------------------------------------------------------------- */

/* Ida y vuelta máxima para estimar la hora del servidor: el error de tomar el punto medio es de
 * hasta RTT/2, así que una solicitud lenta (4G, TLS completo) daría un desfase falso. */
#define CLOCK_MAX_RTT_MS 3000

static void observe_server_time(const json_node *root, int64_t sent_ms, int64_t received_ms)
{
    int64_t server;
    const char *text = json_string_or(json_get(root, "serverTime"), NULL);
    if (!text || iso_to_ms(text, &server) != 0)
        return;
    int64_t rtt = received_ms - sent_ms;
    if (rtt < 0 || rtt > CLOCK_MAX_RTT_MS)
        return;
    /* sent/received vienen de wall_ms() (ya corregido): el desfase se mide contra el reloj del
     * sistema sin corregir; si no, cada corrección se ve como un desfase opuesto y oscila. */
    clock_observe_server(server, sent_ms + rtt / 2 - clock_offset_ms());
}

static void log_http_failure(const char *what, const http_response *resp)
{
    char excerpt[300] = "";
    if (resp->body)
        copy_str(excerpt, sizeof(excerpt), resp->body);
    if (resp->status == 401)
        LOGE("%s: el portal rechazó el token (HTTP 401). Revisa CAM5_GATEWAY_TOKEN en Provisionamiento: %s", what, excerpt);
    else
        LOGW("%s: HTTP %d %s", what, resp->status, excerpt);
}

static void free_devices(gateway *gw)
{
    for (int i = 0; i < gw->ndevices; i++)
        device_free(&gw->devices[i]);
    free(gw->devices);
    gw->devices = NULL;
    gw->ndevices = 0;
}

static int apply_configuration(gateway *gw, const json_node *root)
{
    const json_node *devices = json_get(root, "devices");
    const char *code = json_string_or(json_get(json_get(root, "gateway"), "code"), NULL);
    if (!code || !devices || devices->type != JSON_ARRAY) {
        LOGE("La configuración recibida no tiene gateway.code ni devices");
        return -1;
    }
    strbuf sig;
    sb_init(&sig);
    sb_puts(&sig, code);
    json_write(&sig, devices);
    uint64_t signature = fnv1a64(sig.data, sig.len, 0);
    sb_free(&sig);
    if (gw->have_config && signature == gw->config_signature)
        return 0;

    free_devices(gw);
    copy_str(gw->code, sizeof(gw->code), code);
    gw->devices = calloc(json_count(devices) + 1, sizeof(device));
    if (!gw->devices)
        return -1;
    double heartbeat_ms = 0;
    for (const json_node *n = devices->child; n; n = n->next) {
        if (device_from_json(&gw->devices[gw->ndevices], n, &gw->cfg) == 0)
            gw->ndevices++;
        double hb = json_number_or(json_get(json_get(n, "uploadPolicy"), "heartbeatIntervalMs"), 30000);
        if (heartbeat_ms == 0 || hb < heartbeat_ms)
            heartbeat_ms = hb;
    }
    gw->heartbeat_s = (heartbeat_ms > 0 ? heartbeat_ms : 30000) / 1000.0;
    gw->config_signature = signature;
    gw->have_config = 1;
    if (!gw->ndevices)
        LOGW("El gateway %s no tiene controladores asignados en el portal", gw->code);
    LOGI("Configuración aplicada: gateway %s, %d controlador(es)", gw->code, gw->ndevices);
    return 0;
}

static int apply_text(gateway *gw, const char *text, size_t len, const char *origin)
{
    char err[160];
    json_node *root = json_parse(text, len, err, sizeof(err));
    if (!root) {
        LOGE("Configuración %s inválida: %s", origin, err);
        return -1;
    }
    int rc = apply_configuration(gw, root);
    json_free(root);
    return rc;
}

static void path_in_state(const gateway *gw, char *out, size_t size, const char *name)
{
    snprintf(out, size, "%s/%s", gw->cfg.state_dir, name);
}

static void load_cached_configuration(gateway *gw)
{
    char path[600], etag_path[600];
    path_in_state(gw, path, sizeof(path), "config.json");
    path_in_state(gw, etag_path, sizeof(etag_path), "config.etag");
    size_t len;
    char *text = read_file(path, &len, 4 * 1024 * 1024);
    if (!text)
        return;
    if (apply_text(gw, text, len, "local") == 0) {
        LOGI("Usando la configuración guardada mientras se consulta el portal");
        char *etag = read_file(etag_path, NULL, sizeof(gw->etag));
        if (etag) {
            etag[strcspn(etag, "\r\n")] = '\0';
            copy_str(gw->etag, sizeof(gw->etag), etag);
            free(etag);
        }
    }
    free(text);
}

static int load_configuration(gateway *gw)
{
    http_response resp;
    char err[300];
    int64_t sent = wall_ms();
    if (http_request(&gw->http, "GET", "/gateway/config", gw->cfg.token, NULL, 0,
                     gw->have_config ? gw->etag : NULL, &resp, err, sizeof(err)) != 0) {
        LOGW("Sin acceso a la configuración remota (%s)%s", err, gw->have_config ? "; se usa la copia local" : "");
        return gw->have_config ? 0 : -1;
    }
    int64_t received = wall_ms();
    int rc = 0;
    if (resp.status == 304) {
        LOGD("Configuración sin cambios (304)");
    } else if (resp.status == 200) {
        char err2[160];
        json_node *root = json_parse(resp.body, resp.body_len, err2, sizeof(err2));
        if (!root) {
            LOGE("Configuración remota inválida: %s", err2);
            rc = gw->have_config ? 0 : -1;
        } else {
            observe_server_time(root, sent, received);
            if (apply_configuration(gw, root) == 0) {
                char path[600], etag_path[600];
                path_in_state(gw, path, sizeof(path), "config.json");
                path_in_state(gw, etag_path, sizeof(etag_path), "config.etag");
                if (write_file_atomic(path, resp.body, resp.body_len) != 0)
                    LOGW("No se pudo guardar la copia local de la configuración en %s", path);
                copy_str(gw->etag, sizeof(gw->etag), resp.etag);
                if (resp.etag[0])
                    write_file_atomic(etag_path, resp.etag, strlen(resp.etag));
                else
                    unlink(etag_path);
            } else if (!gw->have_config) {
                rc = -1;
            }
            json_free(root);
        }
    } else {
        log_http_failure("Configuración remota", &resp);
        rc = gw->have_config ? 0 : -1;
    }
    http_response_free(&resp);
    return rc;
}

static void backoff(gateway *gw, const char *reason);

static void heartbeat(gateway *gw)
{
    http_response resp;
    char err[300];
    int64_t sent = wall_ms();
    if (http_request(&gw->http, "POST", "/gateway/heartbeat", gw->cfg.token, "{}", 2, NULL, &resp, err, sizeof(err)) != 0) {
        char reason[340];
        snprintf(reason, sizeof(reason), "heartbeat fallido: %s", err);
        backoff(gw, reason);
        return;
    }
    if (resp.status >= 200 && resp.status < 300) {
        json_node *root = json_parse(resp.body, resp.body_len, NULL, 0);
        observe_server_time(root, sent, wall_ms());
        double next = json_number_or(json_get(root, "nextHeartbeatInMs"), gw->heartbeat_s * 1000);
        if (next >= 5000)
            gw->heartbeat_s = next / 1000.0;
        json_free(root);
        gw->last_contact = mono_now();
        gw->retry_index = 0;
        gw->next_attempt = 0; /* hay red: la cola puede vaciarse ya */
    } else {
        log_http_failure("Heartbeat", &resp);
    }
    http_response_free(&resp);
}

static void backoff(gateway *gw, const char *reason)
{
    int idx = gw->retry_index < COUNT(RETRY_DELAYS) ? gw->retry_index : COUNT(RETRY_DELAYS) - 1;
    int delay = RETRY_DELAYS[idx];
    gw->retry_index++;
    gw->next_attempt = mono_now() + delay;
    LOGW("Envío pendiente (%lu lote(s) en cola); reintento en %d s: %s", gw->queue.count, delay, reason);
}

static device *device_by_code(gateway *gw, const char *code)
{
    for (int i = 0; i < gw->ndevices; i++)
        if (!strcmp(gw->devices[i].code, code))
            return &gw->devices[i];
    return NULL;
}

static int permanent_rejection(int status)
{
    return status == 400 || status == 403 || status == 404 || status == 413 || status == 422;
}

static void flush_queue(gateway *gw)
{
    if (mono_now() < gw->next_attempt || gw->queue.count == 0)
        return;
    queue_item items[MAX_FLUSH_PER_LOOP];
    int n = queue_oldest(&gw->queue, items, MAX_FLUSH_PER_LOOP);
    for (int i = 0; i < n && g_running; i++) {
        if (wall_ms() - items[i].completed_ms > QUEUE_MAX_AGE_MS) {
            LOGW("Lote %s excede 7 días; se archiva sin enviar", items[i].name);
            queue_reject(&gw->queue, &items[i]);
            continue;
        }
        size_t len;
        char *payload = queue_load(&gw->queue, &items[i], &len);
        if (!payload) {
            LOGW("Lote %s ilegible; se archiva", items[i].name);
            queue_reject(&gw->queue, &items[i]);
            continue;
        }
        size_t prefix = sizeof(PAYLOAD_PREFIX) - 1;
        if (len > prefix + ISO_LEN && !memcmp(payload, PAYLOAD_PREFIX, prefix)) {
            char now[ISO_LEN + 1];
            iso_from_ms(wall_ms(), now);
            memcpy(payload + prefix, now, ISO_LEN);
        }

        http_response resp;
        char err[300];
        int64_t sent = wall_ms();
        int rc = http_request(&gw->http, "POST", "/gateway/ingest", gw->cfg.token, payload, len, NULL, &resp, err, sizeof(err));
        int64_t received = wall_ms();
        if (rc != 0) {
            free(payload);
            backoff(gw, err);
            break;
        }
        if (resp.status == 200 || resp.status == 202) {
            json_node *answer = json_parse(resp.body, resp.body_len, NULL, 0);
            json_node *batch = json_parse(payload, len, NULL, 0);
            const char *status = json_string_or(json_get(answer, "status"), "accepted");
            const char *trigger = json_string_or(json_get(batch, "trigger"), "?");
            const char *code = json_string_or(json_get(json_get(batch, "device"), "code"), "?");
            LOGI("%s %s %s: %d registro(s)", status, code, trigger, (int) json_number_or(json_get(answer, "accepted"), 0));
            observe_server_time(answer, sent, received);
            double next_upload = json_number_or(json_get(answer, "nextUploadInMs"), 0);
            /* El portal mide el intervalo desde que recibió el lote; seguir su
             * indicación evita envíos «deferred». Un diagnóstico con registros
             * fuera de rango o sin dato también guarda los canales operativos. */
            int stored_operational = strcmp(trigger, "diagnostic") != 0 || json_number_or(json_get(answer, "operationalReadings"), 0) > 0;
            if (next_upload > 0 && stored_operational && strcmp(trigger, "error") != 0) {
                device *d = device_by_code(gw, code);
                if (d)
                    d->next_storage = mono_now() + next_upload / 1000.0;
            }
            if (strcmp(status, "duplicate") != 0)
                gw->last_contact = mono_now(); /* el portal ya registró la conectividad */
            json_free(answer);
            json_free(batch);
            queue_remove(&gw->queue, &items[i]);
            gw->retry_index = 0;
        } else if (permanent_rejection(resp.status)) {
            char excerpt[400] = "";
            if (resp.body)
                copy_str(excerpt, sizeof(excerpt), resp.body);
            LOGE("Lote %s rechazado (%d): %s", items[i].name, resp.status, excerpt);
            queue_reject(&gw->queue, &items[i]);
        } else {
            char reason[64];
            snprintf(reason, sizeof(reason), "HTTP %d", resp.status);
            log_http_failure("Ingestión", &resp);
            http_response_free(&resp);
            free(payload);
            backoff(gw, reason);
            break;
        }
        http_response_free(&resp);
        free(payload);
    }
}

static void log_stats(gateway *gw)
{
    const http_client *h = &gw->http;
    LOGI("Estado: %d controlador(es), cola %lu lote(s) (%llu KB); HTTP %lu solicitud(es), %lu conexión(es) (%lu reanudadas), "
         "%.1f KB enviados, %.1f KB recibidos desde el arranque",
         gw->ndevices, gw->queue.count, (unsigned long long) (gw->queue.bytes / 1024), h->requests, h->connections, h->resumed,
         (double) h->bytes_sent / 1024.0, (double) h->bytes_received / 1024.0);
}

/* ---- Ciclo principal ---------------------------------------------------- */

static int run(gateway *gw)
{
    load_cached_configuration(gw);
    while (g_running) {
        double now = mono_now();
        if (now >= gw->next_config) {
            if (load_configuration(gw) == 0) {
                gw->next_config = now + CONFIG_REFRESH_SECONDS;
            } else {
                if (gw->cfg.run_once) {
                    LOGE("No fue posible obtener la configuración y no hay copia local");
                    return 1;
                }
                LOGW("Sin configuración todavía; nuevo intento en %d s", CONFIG_RETRY_SECONDS);
                gw->next_config = now + CONFIG_RETRY_SECONDS;
            }
        }
        if (gw->have_config && now >= gw->next_heartbeat && now >= gw->next_attempt) {
            /* Un lote aceptado ya actualiza la conectividad en el portal:
             * el heartbeat solo se envía si no hubo contacto en el intervalo.
             * Durante una caída de red espera el mismo retroceso que la cola,
             * para no bloquear el ciclo con dos intentos fallidos seguidos. */
            double idle = gw->heartbeat_s > gw->cfg.heartbeat_idle_s ? gw->heartbeat_s : gw->cfg.heartbeat_idle_s;
            if (now - gw->last_contact >= idle - 1 || gw->last_contact == 0)
                heartbeat(gw);
            gw->next_heartbeat = now + gw->heartbeat_s;
        }
        for (int i = 0; i < gw->ndevices; i++) {
            device_poll(gw, &gw->devices[i], now);
            device_due(gw, &gw->devices[i], now);
        }
        flush_queue(gw);
        if (now >= gw->next_stats || g_dump_stats) {
            if (gw->next_stats > 0)
                log_stats(gw);
            gw->next_stats = now + STATS_INTERVAL_SECONDS;
            g_dump_stats = 0;
        }
        if (gw->cfg.run_once) {
            log_stats(gw);
            return gw->queue.count == 0 ? 0 : 1;
        }
        sleep_ms(LOOP_SLEEP_MS);
    }
    LOGI("Deteniendo gateway…");
    log_stats(gw);
    return 0;
}

/* ---- Diagnóstico en terreno --------------------------------------------- */

static int probe(const char *target, int unit)
{
    char host[128];
    copy_str(host, sizeof(host), target);
    int port = 502;
    char *colon = strrchr(host, ':');
    if (colon) {
        *colon = '\0';
        port = atoi(colon + 1);
    }
    modbus_client mb;
    modbus_init(&mb, host, port, unit, 2000, 1, env_int("CAM5_MAX_READ", 81, 1, 125));
    uint16_t values[105];
    modbus_error err;
    int offset = env_int("CAM5_REGISTER_OFFSET", 0, -65535, 65535);
    if (modbus_read(&mb, 3, 418, 105, offset, values, &err) != 0) {
        fprintf(stderr, "%s: %s\n", err.code, err.message);
        modbus_close(&mb);
        return 1;
    }
    modbus_close(&mb);
    printf("CAM-5 %s:%d Unit %d — registros 418–522 (FC03)\n", host, port, unit);
    printf("registro  crudo  hex     int16   nota\n");
    for (int i = 0; i < 105; i++) {
        uint16_t v = values[i];
        const char *note = v == 0x8000 ? "sin dato (int16)" : v == 0xFFFF ? "sin dato (uint16)" : "";
        printf("%8d  %5u  0x%04X  %6d  %s\n", 418 + i, v, v, (int) (int16_t) v, note);
    }
    return 0;
}

static void usage(const char *prog)
{
    printf("HoitLive CAM5 Gateway %s (C)\n\n"
           "Uso:\n"
           "  %s [--env-file ARCHIVO] [--once]     servicio (configuración por entorno)\n"
           "  %s --probe IP[:PUERTO] [--unit N]     lee 418–522 de un CAM-5 y muestra la tabla\n"
           "  %s --version\n\n"
           "Variables: CAM5_API_BASE, CAM5_GATEWAY_TOKEN, CAM5_STATE_DIR, CAM5_CA_FILE,\n"
           "CAM5_HOST_OVERRIDES, CAM5_LOG_FILE, CAM5_LOG_LEVEL, CAM5_QUEUE_MAX_MB, CAM5_HTTP_TIMEOUT.\n"
           "Detalle en gateway/c/README.md.\n",
           CAM5_VERSION, prog, prog, prog);
}

int main(int argc, char **argv)
{
    const char *env_file = NULL, *probe_target = NULL;
    int once = 0, unit = 1;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--env-file") && i + 1 < argc)
            env_file = argv[++i];
        else if (!strcmp(argv[i], "--once"))
            once = 1;
        else if (!strcmp(argv[i], "--probe") && i + 1 < argc)
            probe_target = argv[++i];
        else if (!strcmp(argv[i], "--unit") && i + 1 < argc)
            unit = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--version")) {
            printf("cam5-gateway %s · %s\n", CAM5_VERSION, http_tls_backend());
            return 0;
        } else {
            usage(argv[0]);
            return !strcmp(argv[i], "--help") || !strcmp(argv[i], "-h") ? 0 : 2;
        }
    }
    if (env_file && load_env_file(env_file) != 0)
        return 2;
    if (probe_target)
        return probe(probe_target, unit);

    gateway *gw = calloc(1, sizeof(gateway));
    if (!gw || load_settings(&gw->cfg) != 0)
        return 2;
    if (once)
        gw->cfg.run_once = 1;
    log_set_level(log_level_from_name(getenv("CAM5_LOG_LEVEL")));
    if (gw->cfg.log_file[0] && log_open_file(gw->cfg.log_file, 512 * 1024) != 0) {
        fprintf(stderr, "No se pudo abrir CAM5_LOG_FILE %s: %s\n", gw->cfg.log_file, strerror(errno));
        return 2;
    }

    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = on_signal;
    sigaction(SIGTERM, &sa, NULL);
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGUSR1, &sa, NULL);
    sa.sa_handler = SIG_IGN;
    sigaction(SIGPIPE, &sa, NULL);

    if (mkdir_p(gw->cfg.state_dir) != 0) {
        LOGE("No se pudo crear CAM5_STATE_DIR %s: %s", gw->cfg.state_dir, strerror(errno));
        return 2;
    }
    if (queue_open(&gw->queue, gw->cfg.state_dir, gw->cfg.queue_max_bytes) != 0) {
        LOGE("No se pudo abrir la cola en %s: %s", gw->cfg.state_dir, strerror(errno));
        return 2;
    }
    char err[300];
    if (http_init(&gw->http, gw->cfg.api_base, gw->cfg.ca_file, gw->cfg.http_timeout, err, sizeof(err)) != 0) {
        LOGE("%s", err);
        return 2;
    }
    if (uuid4(gw->boot_id) != 0) {
        LOGE("No se pudo generar el bootId (/dev/urandom)");
        return 2;
    }
    gw->started = mono_now();
    gw->heartbeat_s = 30;
    LOGI("HoitLive CAM5 Gateway %s (C, %s) boot %s; %lu lote(s) pendientes en %s",
         CAM5_VERSION, http_tls_backend(), gw->boot_id, gw->queue.count, gw->cfg.state_dir);

    int rc = run(gw);
    free_devices(gw);
    http_cleanup(&gw->http);
    free(gw);
    return rc;
}
