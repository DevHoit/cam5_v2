/*
 * modbus.h — cliente Modbus TCP de solo lectura (funciones 3 y 4).
 * Nunca escribe registros del CAM-5.
 */
#ifndef CAM5_MODBUS_H
#define CAM5_MODBUS_H

#include "compat.h"

#include <stdint.h>

typedef struct {
    char code[40];     /* MODBUS_TIMEOUT, MODBUS_CONNECTION, MODBUS_EXCEPTION_02… */
    char message[300];
} modbus_error;

typedef struct {
    char host[128];
    int port;
    int unit_id;
    int timeout_ms;
    int retries;
    int max_read;      /* registros por transacción; el CAM-5 admite 81 */
    int fd;
    uint16_t transaction_id;
} modbus_client;

void modbus_init(modbus_client *mb, const char *host, int port, int unit_id, int timeout_ms, int retries, int max_read);
void modbus_close(modbus_client *mb);
/*
 * Lee count registros desde start (dirección nativa CAM-5 + offset),
 * dividiendo en bloques de max_read. Devuelve 0 si todo se leyó.
 */
int modbus_read(modbus_client *mb, int function, int start, int count, int offset, uint16_t *out, modbus_error *err);

#endif
