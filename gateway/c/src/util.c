#include "compat.h"

#include "util.h"

#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

/* ---- Registro de eventos ------------------------------------------------ */

static int g_level = LOG_LVL_INFO;
static FILE *g_log_file = NULL;
static char g_log_path[512];
static long g_log_max = 0;

int log_level_from_name(const char *name)
{
    if (!name || !*name)
        return LOG_LVL_INFO;
    if (!strcasecmp(name, "DEBUG"))
        return LOG_LVL_DEBUG;
    if (!strcasecmp(name, "WARNING") || !strcasecmp(name, "WARN"))
        return LOG_LVL_WARN;
    if (!strcasecmp(name, "ERROR"))
        return LOG_LVL_ERROR;
    return LOG_LVL_INFO;
}

void log_set_level(int level) { g_level = level; }
int log_get_level(void) { return g_level; }

int log_open_file(const char *path, long max_bytes)
{
    if (g_log_file) {
        fclose(g_log_file);
        g_log_file = NULL;
    }
    if (!path || !*path)
        return 0;
    if (copy_str(g_log_path, sizeof(g_log_path), path) != 0)
        return -1;
    g_log_max = max_bytes > 0 ? max_bytes : 512 * 1024;
    g_log_file = fopen(g_log_path, "a");
    return g_log_file ? 0 : -1;
}

static void log_rotate_if_needed(void)
{
    if (!g_log_file || ftell(g_log_file) < g_log_max)
        return;
    char old[sizeof(g_log_path) + 4];
    snprintf(old, sizeof(old), "%s.1", g_log_path);
    fclose(g_log_file);
    rename(g_log_path, old); /* conserva una sola generación anterior */
    g_log_file = fopen(g_log_path, "a");
}

void log_msg(int level, const char *fmt, ...)
{
    if (level < g_level)
        return;
    const char *name = level >= LOG_LVL_ERROR ? "ERROR"
                     : level >= LOG_LVL_WARN  ? "WARNING"
                     : level >= LOG_LVL_INFO  ? "INFO"
                                              : "DEBUG";
    char stamp[ISO_LEN + 1];
    iso_from_ms(wall_ms(), stamp);

    FILE *out = g_log_file ? g_log_file : stdout;
    va_list ap;
    va_start(ap, fmt);
    fprintf(out, "%s %s ", stamp, name);
    vfprintf(out, fmt, ap);
    fputc('\n', out);
    va_end(ap);
    fflush(out);
    log_rotate_if_needed();
}

/* ---- Tiempo ------------------------------------------------------------- */

/* 1 de enero de 2025: un reloj anterior a esto no está sincronizado. */
#define MIN_VALID_EPOCH_MS INT64_C(1735689600000)
/* Variaciones menores no se aplican, para no introducir ruido en las marcas. */
#define OFFSET_TOLERANCE_MS 2000

static int64_t g_offset_ms = 0;
static int g_offset_known = 0;

double mono_now(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double) ts.tv_sec + (double) ts.tv_nsec / 1e9;
}

/* Segundos desde el arranque del equipo, comparables con /proc/uptime. */
double uptime_now(void)
{
#ifdef CLOCK_BOOTTIME
    struct timespec ts;
    if (clock_gettime(CLOCK_BOOTTIME, &ts) == 0)
        return (double) ts.tv_sec + (double) ts.tv_nsec / 1e9;
#endif
    return mono_now();
}

int64_t system_ms(void)
{
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (int64_t) tv.tv_sec * 1000 + tv.tv_usec / 1000;
}

int64_t wall_ms(void) { return system_ms() + g_offset_ms; }

void clock_observe_server(int64_t server_ms, int64_t local_ms)
{
    int64_t measured = server_ms - local_ms;
    int64_t diff = measured - g_offset_ms;
    if (diff < 0)
        diff = -diff;
    if (diff > OFFSET_TOLERANCE_MS) {
        LOGW("Reloj del sistema desfasado %+.1f s respecto del servidor; se corrigen las marcas de tiempo", (double) measured / 1000.0);
        g_offset_ms = measured;
    }
    g_offset_known = 1;
}

int64_t clock_offset_ms(void) { return g_offset_ms; }
int clock_offset_known(void) { return g_offset_known; }
int clock_trusted(void) { return g_offset_known || system_ms() >= MIN_VALID_EPOCH_MS; }

/* Días desde 1970-01-01 para una fecha civil (algoritmo de H. Hinnant). */
static int64_t days_from_civil(int64_t y, unsigned m, unsigned d)
{
    y -= m <= 2;
    const int64_t era = (y >= 0 ? y : y - 399) / 400;
    const unsigned yoe = (unsigned) (y - era * 400);
    const unsigned doy = (153 * (m + (m > 2 ? (unsigned) -3 : 9)) + 2) / 5 + d - 1;
    const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + (int64_t) doe - 719468;
}

void iso_from_ms(int64_t ms, char out[ISO_LEN + 1])
{
    if (ms < 0)
        ms = 0;
    time_t seconds = (time_t) (ms / 1000);
    struct tm tm;
    gmtime_r(&seconds, &tm);
    char buf[80]; /* holgado: el compilador no puede acotar los campos de tm */
    snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
             (tm.tm_year + 1900) % 10000, tm.tm_mon + 1, tm.tm_mday,
             tm.tm_hour, tm.tm_min, tm.tm_sec, (int) (ms % 1000));
    memcpy(out, buf, ISO_LEN);
    out[ISO_LEN] = '\0';
}

int iso_to_ms(const char *text, int64_t *out)
{
    int y, mo, d, h, mi, s, frac = 0, frac_digits = 0;
    if (!text || sscanf(text, "%4d-%2d-%2dT%2d:%2d:%2d", &y, &mo, &d, &h, &mi, &s) != 6)
        return -1;
    const char *p = text + 19;
    if (*p == '.') {
        p++;
        while (*p >= '0' && *p <= '9') {
            if (frac_digits < 3) {
                frac = frac * 10 + (*p - '0');
                frac_digits++;
            }
            p++;
        }
        while (frac_digits < 3) {
            frac *= 10;
            frac_digits++;
        }
    }
    if (*p != 'Z' || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60)
        return -1;
    int64_t days = days_from_civil(y, (unsigned) mo, (unsigned) d);
    *out = ((days * 24 + h) * 60 + mi) * INT64_C(60000) + (int64_t) s * 1000 + frac;
    return 0;
}

void sleep_ms(long ms)
{
    struct timespec ts = { ms / 1000, (ms % 1000) * 1000000L };
    while (nanosleep(&ts, &ts) != 0 && errno == EINTR) {
    }
}

/* ---- Varios ------------------------------------------------------------- */

int uuid4(char out[37])
{
    unsigned char b[16];
    int fd = open("/dev/urandom", O_RDONLY);
    if (fd < 0)
        return -1;
    ssize_t n = read(fd, b, sizeof(b));
    close(fd);
    if (n != (ssize_t) sizeof(b))
        return -1;
    b[6] = (unsigned char) ((b[6] & 0x0F) | 0x40);
    b[8] = (unsigned char) ((b[8] & 0x3F) | 0x80);
    snprintf(out, 37, "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
             b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]);
    return 0;
}

int mkdir_p(const char *path)
{
    char buf[1024];
    if (copy_str(buf, sizeof(buf), path) != 0)
        return -1;
    for (char *p = buf + 1; *p; p++) {
        if (*p != '/')
            continue;
        *p = '\0';
        if (mkdir(buf, 0750) != 0 && errno != EEXIST)
            return -1;
        *p = '/';
    }
    if (mkdir(buf, 0750) != 0 && errno != EEXIST)
        return -1;
    return 0;
}

static void fsync_parent(const char *path)
{
    char dir[1024];
    if (copy_str(dir, sizeof(dir), path) != 0)
        return;
    char *slash = strrchr(dir, '/');
    if (!slash)
        copy_str(dir, sizeof(dir), ".");
    else if (slash == dir)
        dir[1] = '\0';
    else
        *slash = '\0';
    int fd = open(dir, O_RDONLY);
    if (fd >= 0) {
        fsync(fd);
        close(fd);
    }
}

int write_file_atomic(const char *path, const char *data, size_t len)
{
    char tmp[1100];
    if (snprintf(tmp, sizeof(tmp), "%s.tmp", path) >= (int) sizeof(tmp))
        return -1;
    int fd = open(tmp, O_WRONLY | O_CREAT | O_TRUNC, 0640);
    if (fd < 0)
        return -1;
    size_t done = 0;
    while (done < len) {
        ssize_t n = write(fd, data + done, len - done);
        if (n < 0 && errno == EINTR)
            continue;
        if (n <= 0) {
            close(fd);
            unlink(tmp);
            return -1;
        }
        done += (size_t) n;
    }
    if (fsync(fd) != 0 || close(fd) != 0) {
        unlink(tmp);
        return -1;
    }
    if (rename(tmp, path) != 0) {
        unlink(tmp);
        return -1;
    }
    fsync_parent(path);
    return 0;
}

char *read_file(const char *path, size_t *len, size_t max_len)
{
    FILE *f = fopen(path, "rb");
    if (!f)
        return NULL;
    size_t cap = 4096, used = 0;
    char *buf = malloc(cap);
    while (buf) {
        if (used + 1 >= cap) {
            if (cap >= max_len) {
                free(buf);
                buf = NULL;
                break;
            }
            char *grown = realloc(buf, cap * 2);
            if (!grown) {
                free(buf);
                buf = NULL;
                break;
            }
            buf = grown;
            cap *= 2;
        }
        size_t n = fread(buf + used, 1, cap - used - 1, f);
        used += n;
        if (n == 0)
            break;
    }
    if (buf && ferror(f)) {
        free(buf);
        buf = NULL;
    }
    fclose(f);
    if (!buf)
        return NULL;
    buf[used] = '\0';
    if (len)
        *len = used;
    return buf;
}

uint64_t fnv1a64(const void *data, size_t len, uint64_t seed)
{
    const unsigned char *p = data;
    uint64_t h = seed ? seed : UINT64_C(14695981039346656037);
    for (size_t i = 0; i < len; i++) {
        h ^= p[i];
        h *= UINT64_C(1099511628211);
    }
    return h;
}

int copy_str(char *dst, size_t size, const char *src)
{
    if (!size)
        return -1;
    size_t n = src ? strlen(src) : 0;
    if (n >= size) {
        memcpy(dst, src, size - 1);
        dst[size - 1] = '\0';
        return -1;
    }
    if (n)
        memcpy(dst, src, n);
    dst[n] = '\0';
    return 0;
}
