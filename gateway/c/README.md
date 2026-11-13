# Gateway CAM-5 en C — SIMCom SIM7600SA-H (OpenLinux)

Versión en C de [`cam5_gateway.py`](../cam5_gateway.py) para equipos sin Python, en particular el módulo **SIMCom SIM7600SA-H con OpenLinux**. Lee uno o varios CAM-5 por Modbus TCP y publica en HoitLive Core (`core.hoitlive.com`) con el mismo contrato: [`CAM5_GATEWAY_PROTOCOL.md`](../CAM5_GATEWAY_PROTOCOL.md).

```
CAM-5 ──Modbus TCP (Ethernet)──▶ cam5-gateway ──HTTPS (4G)──▶ core.hoitlive.com/api/v1
                                      │
                               cola en flash (/data)
```

- Un binario de ~45 KB (ARMv7, sin símbolos) que solo depende de libc y OpenSSL; la configuración viene del portal.
- Modbus TCP de **solo lectura** (funciones 3 y 4), en bloques de 81 registros (límite del CAM-5).
- Configuración remota (`GET /gateway/config`) cada 15 minutos, con copia local si el portal no responde.
- Telemetría operativa cada minuto, diagnóstico completo cada 5 minutos y envío inmediato ante alarma o recuperación.
- Cola persistente: cada lote se guarda en flash antes de enviarse y se borra al ser aceptado. Sobrevive a cortes de 4G, de energía y reinicios.
- Mismas variables de entorno que el gateway Python (`CAM5_HOST_OVERRIDES` solo en formato `CODIGO=ip:puerto`).

## Diferencias con el gateway Python

Ambos producen lotes que el portal procesa igual. La versión C agrega lo necesario para un enlace 4G con plan de datos:

| Aspecto | Python | C |
|---|---|---|
| Conexión HTTPS | nueva en cada solicitud | se mantiene abierta; al reconectar reanuda la sesión TLS |
| Configuración cada 15 min | descarga completa (~31 KB por controlador) | `If-None-Match`: el portal responde `304` sin cuerpo si no cambió |
| Heartbeat | cada 30 s siempre | se omite si un lote aceptado ya actualizó la conectividad en el intervalo |
| Cada lectura del lote | `register`, `rawValue`, `recordedAt`, `sequence`, `quality`, `flags` | `register` y `rawValue`; el resto toma los valores por omisión del contrato |
| Hora del sistema | debe estar sincronizada por NTP | también se corrige con `serverTime` del portal si el reloj del módulo está desfasado |
| Error 401 (token) | archiva el lote | lo conserva y reintenta: rotar el token no pierde datos |
| Cambio de alarma dentro de 30 s del envío anterior | se pierde hasta el siguiente envío programado | queda pendiente y se envía al cumplirse los 30 s |
| Después de un diagnóstico que ya guardó los canales | el siguiente envío programado llega antes de tiempo y el portal lo difiere | espera el intervalo que indica el portal |

El portal deduplica por `batchKey`, así que un lote reenviado tras un corte nunca se guarda dos veces.

## Consumo de datos

Medido durante 10,5 minutos de operación estable contra el portal local detrás de TLS, con un controlador y 11 canales habilitados:

| Configuración | Por minuto | Por mes (30 días) |
|---|---:|---:|
| Por omisión (heartbeat según el portal, cada 30 s sin otro contacto) | 5,5 KB | ~235 MB |
| `CAM5_HEARTBEAT_IDLE_S=90` | ~3,8 KB | ~165 MB |

Se reparte así, por mes:

- Envíos programados (1 por minuto): ~85 MB.
- Diagnósticos (cada 5 minutos, 105 registros): ~55 MB.
- Heartbeats: ~75 MB. Cada lote aceptado ya actualiza la conectividad en el portal, y este marca un gateway como atrasado recién a los 180 s (`staleAfterSeconds` del perfil). Con `CAM5_HEARTBEAT_IDLE_S=90` el heartbeat solo sale si pasaron 90 s sin contacto, lo que en operación normal no ocurre.

Durante toda la medición se usó **una sola conexión TLS**. El gateway Python abre una nueva por solicitud; contra Vercel cada handshake completo pesa ~4,9 KB (medido), lo que con ~3 solicitudes por minuto agrega del orden de 600 MB al mes.

Para dimensionar el plan:

- Cada canal habilitado adicional suma ~1,3 MB al mes.
- Cada controlador adicional suma su propio consumo.
- Las cabeceras de respuesta de Vercel son de tamaño similar a las del entorno de prueba.

En terreno, el gateway informa sus KB enviados y recibidos cada 15 minutos.

`CAM5_TLS_GROUPS` es `X25519:P-256` por omisión. Las versiones recientes de OpenSSL proponen además un intercambio poscuántico (X25519MLKEM768) que duplica el tamaño de cada handshake: 4,0 KB frente a 1,7 KB, medido. Si se prefiere, se activa con `CAM5_TLS_GROUPS=X25519MLKEM768:X25519`.

## Compilar

### En un Linux o Mac, para probar

```bash
cd gateway/c
make                                         # Linux con libssl-dev
make OPENSSL_DIR=/opt/homebrew/opt/openssl   # macOS con Homebrew
make test                                    # pruebas unitarias
```

### Para el SIM7600SA-H

El SIM7600 es un Qualcomm MDM9607 (ARM Cortex-A7, ARMv7, 32 bits) con OpenLinux basado en Yocto y glibc. Se compila con el **SDK OpenLinux de SIMCom**, que trae el toolchain `arm-oe-linux-gnueabi` y un sysroot con las cabeceras de OpenSSL del módulo.

```bash
# 1. Cargar el entorno del SDK (la ruta exacta depende de la versión del SDK)
source /opt/sim7600-sdk/environment-setup-armv7a-vfp-neon-oe-linux-gnueabi

# 2. Compilar y reducir el binario
cd gateway/c
make sim7600
```

Si no usas el script de entorno:

```bash
make sim7600 CROSS_COMPILE=arm-oe-linux-gnueabi- SDK_SYSROOT=/opt/sim7600-sdk/sysroots/armv7a-vfp-neon-oe-linux-gnueabi
```

**Si el módulo no trae `libssl.so`** (el reconocimiento lo indica), enlaza OpenSSL estático. Compílalo una vez con el mismo toolchain:

```bash
./Configure linux-armv4 no-shared no-tests --prefix=/opt/openssl-arm
make && make install_sw
cd gateway/c
make sim7600 OPENSSL_DIR=/opt/openssl-arm \
     OPENSSL_LIBS="/opt/openssl-arm/lib/libssl.a /opt/openssl-arm/lib/libcrypto.a -ldl -lpthread"
```

Verificado en ARMv7 de 32 bits con glibc (cross-compile `armhf` ejecutado con QEMU contra el portal y el simulador), Linux x86-64 con OpenSSL 3.0 y macOS con OpenSSL 4.0. El código contempla OpenSSL 1.0.2 y 1.1.x, pero esas versiones no se han probado: confírmalo al compilar con el SDK.

## Instalar en el módulo

### 0. Reconocimiento

```bash
adb push tools/recon_sim7600.sh /tmp/
adb shell sh /tmp/recon_sim7600.sh 192.168.1.101     # IP de un CAM-5
```

Revisa en la salida:

- **libc y libssl**: deciden si enlazas OpenSSL dinámico o estático.
- **Almacenamiento persistente**: normalmente `/data` (UBIFS). Nunca `/tmp`, que está en RAM.
- **Certificados raíz**: si no hay ninguno, copia el archivo del paso 2.
- **Red hacia el CAM-5**: la interfaz Ethernet del equipo (`eth0` o un adaptador USB‑Ethernet según la placa) y que el ping al CAM-5 responda.
- **Hora**: debe ser la actual en UTC (ver paso 5).

### 1. Credencial

En HoitLive Core, **Administración → Provisionamiento → Nueva credencial**, elige el gateway del sitio y copia el token (se muestra una sola vez). Los controladores deben existir en **Gestión → Estructura operacional** con su IP, puerto 502 y Unit ID.

### 2. Copiar archivos

```bash
adb shell mkdir -p /data/cam5-gateway
adb push cam5-gateway /data/cam5-gateway/
adb push deploy/gateway.env.example /data/cam5-gateway/gateway.env
adb push /etc/ssl/cert.pem /data/cam5-gateway/ca-certificates.crt   # o el bundle de tu equipo
adb shell chmod 755 /data/cam5-gateway/cam5-gateway
adb shell chmod 600 /data/cam5-gateway/gateway.env
```

Edita `gateway.env` en el módulo (`vi`) o antes de copiarlo, con el token y, si corresponde, `CAM5_HOST_OVERRIDES`.

### 3. Probar el CAM-5 sin el portal

```bash
adb shell /data/cam5-gateway/cam5-gateway --probe 192.168.1.101:502 --unit 1
```

Muestra los 105 registros 418–522 en crudo. `0x8000` y `0xFFFF` son "sin dato" (sensor no instalado). Contrasta temperaturas con la pantalla del CAM-5: el registro 418 con valor 684 es 68,4 °C.

### 4. Un ciclo completo contra el portal

```bash
adb shell "/data/cam5-gateway/cam5-gateway --env-file /data/cam5-gateway/gateway.env --once; echo salida=\$?"
adb shell tail -20 /data/cam5-gateway/gateway.log
```

Debe registrar `accepted <controlador> scheduled` por cada CAM-5 y salir con `0`. En el portal, el gateway aparece en línea y los canales con valores.

### 5. Hora del módulo

El portal rechaza lotes con más de 5 minutos de adelanto o más de 7 días de antigüedad. El gateway corrige sus marcas con la hora del portal cuando hay conexión, pero el módulo debería tener la hora correcta desde el arranque:

- Hora de red del operador (NITZ): `AT+CTZU=1` y `AT&W` por el puerto AT del módulo.
- O NTP, si la imagen trae `ntpd`/`ntpdate`.

Mientras la hora no sea confiable (anterior a 2025) y no haya contacto con el portal, el gateway lee pero no arma lotes, para no enviar marcas de tiempo erróneas.

### 6. Dejarlo como servicio

```bash
adb push deploy/cam5-gateway.init /etc/init.d/cam5-gateway
adb shell chmod 755 /etc/init.d/cam5-gateway
adb shell update-rc.d cam5-gateway defaults        # si existe update-rc.d
# sin update-rc.d:
adb shell ln -s ../init.d/cam5-gateway /etc/rc5.d/S99cam5-gateway
adb shell /etc/init.d/cam5-gateway start
```

El script supervisa el proceso y lo reinicia a los 10 s si termina. Si la raíz es de solo lectura, monta en lectura-escritura antes (`mount -o remount,rw /`) o lanza el script desde el mecanismo de arranque que el reconocimiento muestre. En equipos con systemd usa `deploy/cam5-gateway.service`.

Prueba de aceptación mínima: desenergiza el módulo, vuelve a energizarlo y confirma que el gateway reporta solo en menos de un minuto tras tener 4G.

## Operación

| Qué | Cómo |
|---|---|
| Registro | `tail -f /data/cam5-gateway/gateway.log` (rota a 512 KB, guarda una copia `.1`) |
| Estado y consumo | cada 15 min y al detenerse: controladores, lotes en cola, solicitudes, conexiones TLS reanudadas y KB enviados/recibidos. `kill -USR1 <pid>` lo registra en el momento |
| Lotes pendientes | `ls /data/cam5-gateway/queue \| wc -l` |
| Lotes rechazados | `/data/cam5-gateway/rejected/` (se conservan los últimos 100 para revisión) |
| Más detalle | `CAM5_LOG_LEVEL=DEBUG` en `gateway.env` y reiniciar |

Comportamiento ante fallas:

- **4G caído**: los lotes se acumulan en `queue/` (tope `CAM5_QUEUE_MAX_MB`, 16 MB ≈ varios días). Al volver, se envían en orden con reintentos a 2, 5, 15, 30 y 60 s.
- **CAM-5 sin respuesta**: se envía un lote `error` con `readings: []` y `poll.error`, y se reintenta cada 5–60 s sin bloquear a los demás controladores.
- **Portal caído o sin configuración**: se usa la última configuración guardada en `config.json`.
- **Lote rechazado** (`400`, `403`, `404`, `413`, `422`): se mueve a `rejected/` y no se repite. Un `401` no descarta datos: se reintenta hasta que el token se corrija.

## SIM7600 con la plataforma HOIT: modo "solo CAM-5"

Los módulos que vienen con la plataforma HOIT (portal en `/data/hoit`, servicios `hoit_*`) se dejan dedicados al CAM-5 con [`deploy/sim7600/`](./deploy/sim7600/):

| Archivo | Qué hace |
|---|---|
| `apply_cam5_only.sh` | Desactiva meteo, MQTT, el lector Modbus duplicado, RTU, NMEA, digitales, sockets, alarmas locales, trabajos remotos y auditoría; instala la vigilancia de conectividad y la página del portal; borra simuladores, temporales y registros viejos |
| `hoit_conn_watchdog.sh` | Vigilancia de conectividad Wi-Fi + 4G (reemplaza la original, misma interfaz para el portal) |
| `hoit_conn_runner.sh` | Bucle del servicio `hoit_conn` sin escribir en `/data` cada minuto |
| `portal/` | Página **CAM-5 → Core**: servicio, último envío, cola, controladores, registro, reinicio y prueba de lectura Modbus |

```bash
adb shell "cd / && tar czf /cache/respaldo.tgz data/hoit cache/hoit etc/init.d" && adb pull /cache/respaldo.tgz   # respaldo
adb push deploy/sim7600 /cache/cam5-deploy
adb shell "sh /cache/cam5-deploy/apply_cam5_only.sh /cache/cam5-deploy"
```

**Vigilancia de conectividad** (`hoit_conn`, cada 60 s, registro en `/cache/hoit/netwatch.log`):

1. Prueba Wi-Fi y 4G por separado (`ping -I` y HTTPS al portal con `--interface`). Si el 4G es la salida activa y recibe tráfico, no gasta datos en probarlo; en reserva se prueba cada 5 ciclos.
2. Lee el módem por AT con bloqueo del puerto: SIM, registro, tecnología, operador, señal.
3. 4G con falla: a los 3 ciclos reactiva el contexto PDP; a los 8 reinicia la radio (`CFUN=4` → `CFUN=1`) y luego lo repite cada 30 ciclos. Con la SIM ausente o bloqueada solo reintenta la radio cada 30 ciclos.
4. Sin **ninguna** salida durante 45 ciclos reinicia el equipo, como máximo 3 veces en 24 h y nunca antes de 30 min de encendido.
5. Cortafuegos: bloquea ADB por red (puerto 5565, root sin clave) y SSH/portal desde la red celular.
6. Escribe `/cache/hoit/gateway_status_current.json`, que muestra la página Conectividad.

Los umbrales se ajustan en `/data/hoit/config/hoit_conn.conf` (`PDP_RESET_AFTER`, `RADIO_RESET_AFTER`, `RADIO_RESET_EVERY`, `REBOOT_AFTER`, `REBOOT_MAX_PER_DAY`). El APN se cambia desde la página Conectividad del portal.

## Variables de entorno

| Variable | Por defecto | Uso |
|---|---|---|
| `CAM5_API_BASE` | (obligatoria) | `https://core.hoitlive.com/api/v1` |
| `CAM5_GATEWAY_TOKEN` | (obligatoria) | token de Provisionamiento |
| `CAM5_STATE_DIR` | `/data/cam5-gateway` | configuración local, cola y lotes rechazados |
| `CAM5_CA_FILE` | almacén del sistema | certificados raíz PEM |
| `CAM5_HOST_OVERRIDES` | — | `CODIGO=ip:puerto,…` para usar otra IP que la del portal |
| `CAM5_LOG_FILE` | salida estándar | archivo de registro con rotación |
| `CAM5_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING` |
| `CAM5_QUEUE_MAX_MB` | `16` | tope de la cola; al superarlo se descartan los lotes más antiguos |
| `CAM5_HTTP_TIMEOUT` | `20` | segundos por solicitud sobre 4G |
| `CAM5_TLS_GROUPS` | `X25519:P-256` | intercambio de claves TLS; ver «Consumo de datos» |
| `CAM5_HEARTBEAT_IDLE_S` | intervalo del portal | segundos sin contacto antes de enviar un heartbeat (máx. 170) |
| `CAM5_REGISTER_OFFSET` | `0` | desplazamiento de dirección Modbus |
| `CAM5_MAX_READ` | `81` | registros por transacción Modbus |
| `CAM5_RUN_ONCE` | — | `1` equivale a `--once` |

`--env-file` carga un archivo `CLAVE=valor`; las variables ya definidas en el entorno tienen prioridad. `http://` solo se acepta hacia `localhost`, para que el token nunca viaje sin cifrar.

## Pruebas

```bash
make test                       # JSON, fechas, cola en flash
make asan                       # binario con AddressSanitizer para pruebas largas
```

De punta a punta, sin hardware, con el simulador y el portal local:

```bash
python3 ../tools/cam5_modbus_simulator.py --port 5031 --control /tmp/ctl.json &
CAM5_API_BASE=http://localhost:3001/api/v1 CAM5_GATEWAY_TOKEN=… CAM5_STATE_DIR=/tmp/gw \
CAM5_HOST_OVERRIDES=CAM5-CTRL-01=127.0.0.1:5031 ./cam5-gateway
```

Con `/tmp/ctl.json` se fuerzan una sobretemperatura (`{"overrides": {"418": 812}}`, envío `alarm` inmediato) o un CAM-5 colgado (`{"offline": true}`, lote `error`).
