#include "compat.h"

#include "queue.h"
#include "util.h"

#include <dirent.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define NAME_FORMAT "%013lld-%010lu-%013lld.json"
#define NAME_LENGTH 43
#define MAX_REJECTED_FILES 100

static int parse_name(const char *name, int64_t *stamp, int64_t *completed)
{
    long long s, c;
    unsigned long seq;
    char tail[8];
    if (strlen(name) != NAME_LENGTH)
        return -1;
    if (sscanf(name, "%13lld-%10lu-%13lld%7s", &s, &seq, &c, tail) != 4 || strcmp(tail, ".json") != 0)
        return -1;
    if (stamp)
        *stamp = s;
    if (completed)
        *completed = c;
    return 0;
}

/* Ruta dir/name; -1 si no cabe (nunca ocurre con nombres de la cola). */
static int join(char *out, size_t size, const char *dir, const char *name)
{
    int n = snprintf(out, size, "%s/%s", dir, name);
    return n < 0 || (size_t) n >= size ? -1 : 0;
}

int queue_open(batch_queue *q, const char *state_dir, uint64_t max_bytes)
{
    memset(q, 0, sizeof(*q));
    q->max_bytes = max_bytes;
    snprintf(q->dir, sizeof(q->dir), "%s/queue", state_dir);
    snprintf(q->rejected, sizeof(q->rejected), "%s/rejected", state_dir);
    if (mkdir_p(q->dir) != 0 || mkdir_p(q->rejected) != 0)
        return -1;

    DIR *d = opendir(q->dir);
    if (!d)
        return -1;
    struct dirent *e;
    while ((e = readdir(d)) != NULL) {
        char path[sizeof(q->dir) + QUEUE_NAME_MAX + 2];
        size_t n = strlen(e->d_name);
        if (n > 4 && !strcmp(e->d_name + n - 4, ".tmp")) {
            if (join(path, sizeof(path), q->dir, e->d_name) == 0) /* escritura interrumpida */
                unlink(path);
            continue;
        }
        int64_t stamp;
        if (parse_name(e->d_name, &stamp, NULL) != 0)
            continue;
        struct stat st;
        if (join(path, sizeof(path), q->dir, e->d_name) == 0 && stat(path, &st) == 0) {
            q->bytes += (uint64_t) st.st_size;
            q->count++;
            if (stamp > q->last_stamp)
                q->last_stamp = stamp;
        }
    }
    closedir(d);
    return 0;
}

int queue_oldest(batch_queue *q, queue_item *items, int max)
{
    DIR *d = opendir(q->dir);
    if (!d)
        return 0;
    int n = 0;
    unsigned long count = 0;
    struct dirent *e;
    while ((e = readdir(d)) != NULL) {
        int64_t completed;
        if (parse_name(e->d_name, NULL, &completed) != 0)
            continue;
        count++;
        /* Inserción ordenada en un arreglo pequeño: conserva los max menores. */
        if (n == max && strcmp(e->d_name, items[n - 1].name) >= 0)
            continue;
        int pos = n < max ? n : max - 1;
        while (pos > 0 && strcmp(e->d_name, items[pos - 1].name) < 0) {
            items[pos] = items[pos - 1];
            pos--;
        }
        copy_str(items[pos].name, sizeof(items[pos].name), e->d_name);
        items[pos].completed_ms = completed;
        items[pos].size = 0;
        if (n < max)
            n++;
    }
    closedir(d);
    q->count = count; /* resincroniza el contador con el disco */
    return n;
}

static void enforce_limit(batch_queue *q)
{
    if (!q->max_bytes || q->bytes <= q->max_bytes)
        return;
    unsigned long dropped = 0;
    uint64_t target = q->max_bytes - q->max_bytes / 10;
    while (q->bytes > target) {
        queue_item items[32];
        int n = queue_oldest(q, items, 32);
        if (n == 0)
            break;
        for (int i = 0; i < n && q->bytes > target; i++) {
            queue_remove(q, &items[i]);
            dropped++;
        }
    }
    LOGW("Cola local sobre el límite de %llu KB: se descartaron %lu lote(s) antiguo(s)",
         (unsigned long long) (q->max_bytes / 1024), dropped);
}

int queue_put(batch_queue *q, const char *payload, size_t len, unsigned long sequence, int64_t completed_ms)
{
    int64_t stamp = system_ms();
    if (stamp <= q->last_stamp)
        stamp = q->last_stamp + 1; /* orden estricto aunque el reloj retroceda */
    q->last_stamp = stamp;
    char name[QUEUE_NAME_MAX];
    snprintf(name, sizeof(name), NAME_FORMAT, (long long) stamp, sequence, (long long) completed_ms);
    char path[sizeof(q->dir) + QUEUE_NAME_MAX + 2];
    if (join(path, sizeof(path), q->dir, name) != 0 || write_file_atomic(path, payload, len) != 0) {
        LOGE("No se pudo guardar el lote en %s: %s", path, strerror(errno));
        return -1;
    }
    q->bytes += len;
    q->count++;
    enforce_limit(q);
    return 0;
}

char *queue_load(const batch_queue *q, const queue_item *item, size_t *len)
{
    char path[sizeof(q->dir) + QUEUE_NAME_MAX + 2];
    if (join(path, sizeof(path), q->dir, item->name) != 0)
        return NULL;
    return read_file(path, len, 1024 * 1024);
}

static uint64_t file_size(const char *path)
{
    struct stat st;
    return stat(path, &st) == 0 ? (uint64_t) st.st_size : 0;
}

void queue_remove(batch_queue *q, const queue_item *item)
{
    char path[sizeof(q->dir) + QUEUE_NAME_MAX + 2];
    if (join(path, sizeof(path), q->dir, item->name) != 0)
        return;
    uint64_t size = file_size(path);
    if (unlink(path) == 0) {
        q->bytes = q->bytes > size ? q->bytes - size : 0;
        if (q->count)
            q->count--;
    }
}

static int compare_names(const void *a, const void *b)
{
    return strcmp((const char *) a, (const char *) b);
}

static void prune_rejected(const batch_queue *q)
{
    DIR *d = opendir(q->rejected);
    if (!d)
        return;
    size_t n = 0, cap = 0;
    char (*names)[QUEUE_NAME_MAX] = NULL;
    struct dirent *e;
    while ((e = readdir(d)) != NULL) {
        if (parse_name(e->d_name, NULL, NULL) != 0)
            continue;
        if (n == cap) {
            size_t grown_cap = cap ? cap * 2 : 128;
            void *grown = realloc(names, grown_cap * QUEUE_NAME_MAX);
            if (!grown)
                break;
            names = grown;
            cap = grown_cap;
        }
        copy_str(names[n++], QUEUE_NAME_MAX, e->d_name);
    }
    closedir(d);
    if (n > MAX_REJECTED_FILES) {
        qsort(names, n, QUEUE_NAME_MAX, compare_names);
        for (size_t i = 0; i < n - MAX_REJECTED_FILES; i++) {
            char path[sizeof(q->rejected) + QUEUE_NAME_MAX + 2];
            if (join(path, sizeof(path), q->rejected, names[i]) == 0)
                unlink(path);
        }
    }
    free(names);
}

void queue_reject(batch_queue *q, const queue_item *item)
{
    char from[sizeof(q->dir) + QUEUE_NAME_MAX + 2], to[sizeof(q->rejected) + QUEUE_NAME_MAX + 2];
    if (join(from, sizeof(from), q->dir, item->name) != 0 || join(to, sizeof(to), q->rejected, item->name) != 0)
        return;
    uint64_t size = file_size(from);
    if (rename(from, to) == 0 || unlink(from) == 0) {
        q->bytes = q->bytes > size ? q->bytes - size : 0;
        if (q->count)
            q->count--;
    }
    prune_rejected(q);
}
