/*
 * Pruebas unitarias del gateway C: JSON, marcas de tiempo y cola en flash.
 * Se ejecutan con `make test`. La lectura Modbus y el contrato HTTP se
 * prueban de punta a punta con el simulador (ver README.md).
 */
#include "../src/compat.h"

#include "../src/json.h"
#include "../src/queue.h"
#include "../src/util.h"

#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int failures = 0, checks = 0;

#define CHECK(cond)                                                          \
    do {                                                                     \
        checks++;                                                            \
        if (!(cond)) {                                                       \
            failures++;                                                      \
            fprintf(stderr, "FALLA %s:%d: %s\n", __FILE__, __LINE__, #cond); \
        }                                                                    \
    } while (0)

static void test_json(void)
{
    const char *text =
        "{\"gateway\":{\"code\":\"CAM5-GW-01\"},\"devices\":[{\"code\":\"CAM5-CTRL-01\",\"unitId\":1,"
        "\"registers\":[{\"register\":418,\"scaleFactor\":\"0.100000\",\"errorRawValue\":32768,\"x\":null}],"
        "\"name\":\"Sist\\u00e9ma \\\"A\\\" \\ud83d\\ude00\",\"enabled\":true,\"neg\":-1.5e2}]}";
    char err[120];
    json_node *root = json_parse(text, strlen(text), err, sizeof(err));
    CHECK(root != NULL);
    if (!root)
        return;
    const json_node *dev = json_get(root, "devices")->child;
    CHECK(!strcmp(json_string_or(json_get(json_get(root, "gateway"), "code"), ""), "CAM5-GW-01"));
    CHECK(json_number_or(json_get(dev, "unitId"), 0) == 1);
    const json_node *reg = json_get(dev, "registers")->child;
    CHECK(json_number_or(json_get(reg, "scaleFactor"), 0) == 0.1);
    CHECK(json_number_or(json_get(reg, "errorRawValue"), 0) == 32768);
    CHECK(json_is_null(json_get(reg, "x")));
    CHECK(!strcmp(json_string_or(json_get(dev, "name"), ""), "Sist\xc3\xa9ma \"A\" \xf0\x9f\x98\x80"));
    CHECK(json_bool_or(json_get(dev, "enabled"), 0) == 1);
    CHECK(json_number_or(json_get(dev, "neg"), 0) == -150);
    CHECK(json_count(json_get(dev, "registers")) == 1);

    /* La serialización es estable: sirve para detectar cambios de configuración. */
    strbuf a, b;
    sb_init(&a);
    sb_init(&b);
    json_write(&a, root);
    json_node *again = json_parse(a.data, a.len, err, sizeof(err));
    CHECK(again != NULL);
    json_write(&b, again);
    CHECK(a.len == b.len && !memcmp(a.data, b.data, a.len));
    sb_free(&a);
    sb_free(&b);
    json_free(again);
    json_free(root);

    const char *bad[] = { "{", "{\"a\":}", "[1,]", "{\"a\":1} x", "\"sin cerrar", "{\"a\":\"\\q\"}", "nul", "" };
    for (size_t i = 0; i < sizeof(bad) / sizeof(bad[0]); i++) {
        json_node *n = json_parse(bad[i], strlen(bad[i]), err, sizeof(err));
        CHECK(n == NULL);
        CHECK(err[0] != '\0');
        json_free(n);
    }

    char deep[200];
    memset(deep, '[', 100);
    memset(deep + 100, ']', 100);
    CHECK(json_parse(deep, sizeof(deep), err, sizeof(err)) == NULL); /* límite de anidamiento */

    strbuf s;
    sb_init(&s);
    sb_json_string(&s, "a\"b\\c\n\x01");
    CHECK(!strcmp(s.data, "\"a\\\"b\\\\c\\n\\u0001\""));
    sb_free(&s);
}

static void test_time(void)
{
    int64_t ms = 0;
    CHECK(iso_to_ms("2026-09-05T18:42:16.325Z", &ms) == 0);
    CHECK(ms == INT64_C(1788633736325));
    char out[ISO_LEN + 1];
    iso_from_ms(ms, out);
    CHECK(!strcmp(out, "2026-09-05T18:42:16.325Z"));
    CHECK(strlen(out) == ISO_LEN);
    CHECK(iso_to_ms("2024-02-29T00:00:00Z", &ms) == 0 && ms == INT64_C(1709164800000));
    CHECK(iso_to_ms("2026-11-09T19:00:00.1234567Z", &ms) == 0 && ms % 1000 == 123);
    CHECK(iso_to_ms("2026-11-09 19:00:00Z", &ms) != 0);
    CHECK(iso_to_ms("2026-11-09T19:00:00+03:00", &ms) != 0);

    /* Corrección del reloj con la hora del servidor */
    CHECK(clock_offset_ms() == 0);
    clock_observe_server(system_ms() + 500, system_ms());
    CHECK(clock_offset_ms() == 0); /* desfase tolerable: no se corrige */
    CHECK(clock_offset_known());
    clock_observe_server(system_ms() + 3600000, system_ms());
    CHECK(clock_offset_ms() > 3590000 && clock_offset_ms() < 3610000);
    CHECK(wall_ms() - system_ms() > 3590000);
    clock_observe_server(system_ms(), system_ms());
    CHECK(clock_offset_ms() == 0);
}

static int count_files(const char *dir)
{
    int n = 0;
    DIR *d = opendir(dir);
    struct dirent *e;
    while (d && (e = readdir(d)) != NULL)
        n += e->d_name[0] != '.';
    if (d)
        closedir(d);
    return n;
}

static void test_queue(void)
{
    char dir[] = "/tmp/cam5-queue-test-XXXXXX";
    CHECK(mkdtemp(dir) != NULL);
    batch_queue q;
    CHECK(queue_open(&q, dir, 0) == 0);
    CHECK(q.count == 0);
    char payload[64];
    for (unsigned long i = 1; i <= 7; i++) {
        snprintf(payload, sizeof(payload), "{\"n\":%lu}", i);
        CHECK(queue_put(&q, payload, strlen(payload), i, INT64_C(1788633736325) + (int64_t) i) == 0);
    }
    CHECK(q.count == 7);

    /* Un archivo temporal de una escritura interrumpida se descarta al abrir. */
    char tmp[200];
    snprintf(tmp, sizeof(tmp), "%s/queue/0000000000001-0000000001-0000000000001.json.tmp", dir);
    FILE *f = fopen(tmp, "w");
    if (f) {
        fputs("{\"tru", f);
        fclose(f);
    }
    batch_queue reopened;
    CHECK(queue_open(&reopened, dir, 0) == 0);
    CHECK(reopened.count == 7);
    CHECK(access(tmp, F_OK) != 0);

    queue_item items[3];
    int n = queue_oldest(&q, items, 3);
    CHECK(n == 3);
    size_t len;
    char *first = queue_load(&q, &items[0], &len);
    CHECK(first && !strcmp(first, "{\"n\":1}"));
    free(first);
    CHECK(items[2].completed_ms == INT64_C(1788633736328));
    queue_remove(&q, &items[0]);
    queue_reject(&q, &items[1]);
    n = queue_oldest(&q, items, 3);
    CHECK(n == 3);
    char *next = queue_load(&q, &items[0], &len);
    CHECK(next && !strcmp(next, "{\"n\":3}"));
    free(next);
    CHECK(q.count == 5);

    char rejected[200];
    snprintf(rejected, sizeof(rejected), "%s/rejected", dir);
    CHECK(count_files(rejected) == 1);

    /* Tope de tamaño: se descartan los lotes más antiguos. */
    batch_queue small;
    char dir2[] = "/tmp/cam5-queue-limit-XXXXXX";
    CHECK(mkdtemp(dir2) != NULL);
    CHECK(queue_open(&small, dir2, 1000) == 0);
    char big[200];
    memset(big, 'x', sizeof(big) - 1);
    big[sizeof(big) - 1] = '\0';
    for (unsigned long i = 1; i <= 12; i++)
        queue_put(&small, big, strlen(big), i, 1);
    CHECK(small.bytes <= 1000);
    n = queue_oldest(&small, items, 1);
    CHECK(n == 1 && strstr(items[0].name, "-0000000009-") != NULL);

    char cmd[200];
    snprintf(cmd, sizeof(cmd), "rm -rf %s %s", dir, dir2);
    CHECK(system(cmd) == 0);
}

int main(void)
{
    log_set_level(LOG_LVL_ERROR);
    test_json();
    test_time();
    test_queue();
    printf("%d verificaciones, %d fallas\n", checks, failures);
    return failures ? 1 : 0;
}
