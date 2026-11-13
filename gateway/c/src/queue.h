/*
 * queue.h — cola persistente de lotes en flash.
 *
 * Un archivo por lote: se escribe una vez (temporal + rename, a prueba de
 * cortes de energía) y se borra al ser aceptado. El nombre ordena la cola y
 * lleva la hora de la lectura para descartar lo que el portal ya no acepta
 * sin tener que abrir el archivo.
 */
#ifndef CAM5_QUEUE_H
#define CAM5_QUEUE_H

#include "compat.h"

#include <stddef.h>
#include <stdint.h>

#define QUEUE_NAME_MAX 64

typedef struct {
    char dir[600];
    char rejected[600];
    uint64_t max_bytes;
    uint64_t bytes;
    unsigned long count;
    int64_t last_stamp;
} batch_queue;

typedef struct {
    char name[QUEUE_NAME_MAX];
    int64_t completed_ms;
    uint64_t size;
} queue_item;

int queue_open(batch_queue *q, const char *state_dir, uint64_t max_bytes);
int queue_put(batch_queue *q, const char *payload, size_t len, unsigned long sequence, int64_t completed_ms);
/* Los n lotes más antiguos, en orden de envío. */
int queue_oldest(batch_queue *q, queue_item *items, int max);
char *queue_load(const batch_queue *q, const queue_item *item, size_t *len);
void queue_remove(batch_queue *q, const queue_item *item);
/* Mueve el lote a rejected/ para revisión; conserva solo los más recientes. */
void queue_reject(batch_queue *q, const queue_item *item);

#endif
