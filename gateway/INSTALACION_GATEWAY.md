# Instalación del gateway CAM-5 en terreno

Guía para dejar funcionando `gateway/cam5_gateway.py` en un equipo Linux (Raspberry Pi o PC) dentro de la subestación. El gateway lee cada CAM-5 por Modbus TCP y publica en HoitLive Core según [`CAM5_GATEWAY_PROTOCOL.md`](./CAM5_GATEWAY_PROTOCOL.md).

Si el gateway es un módulo 4G sin Python (por ejemplo SIMCom SIM7600SA-H con OpenLinux), usa la versión en C: [`c/README.md`](./c/README.md). Los pasos de portal (registrar equipos y crear la credencial) son los mismos.

## 1. Requisitos

- Linux con Python 3.9 o superior (Raspberry Pi OS, Debian o Ubuntu). No necesita paquetes adicionales.
- Red local hacia cada CAM-5, puerto TCP 502.
- Salida HTTPS (443) hacia el portal.
- Hora sincronizada por NTP (`timedatectl` debe indicar `System clock synchronized: yes`). El portal rechaza lotes con más de 5 minutos de adelanto.

## 2. Preparar cada CAM-5

Con IntelliSAW Configuration Tool (USB mini-B) y CAM Display Tool:

1. Asignar una IP fija a cada CAM-5. Se puede revisar en la pantalla del equipo, en **NW Info**.
2. Confirmar que Modbus TCP está habilitado. Es el protocolo estándar en los modelos `-AMEU`.
3. Anotar qué sensor SAW quedó en cada registro, por ejemplo `418: Bus - Red`. Los registros 418–429 son los 12 sensores de temperatura (manual CAM-5 §6.1, Figura 31).
4. Anotar cuántos sensores de humedad hay. El primero entrega la temperatura ambiente en el registro 430 y la humedad en el 431.

Desde el gateway, comprueba que cada equipo responde:

```bash
nc -vz 192.168.1.101 502
```

## 3. Registrar los equipos en el portal

En **Gestión → Estructura operacional**:

1. Cliente, sitio y un punto de medición por equipo.
2. Un gateway para el sitio.
3. Un controlador por CAM-5, con su IP, puerto 502 y Unit ID 1, y sus canales configurados.

En **Configuración**, ajusta por punto los nombres de canal según la asignación anotada en el paso 2. Por ejemplo, T01 a T03 son las barras L1, L2 y L3. Habilita los sensores que estén instalados y define los umbrales.

## 4. Credencial del gateway

En **Administración → Provisionamiento → Nueva credencial**, elige el gateway del sitio y genera el token. Se muestra una sola vez: descarga el `.env` o cópialo en ese momento.

## 5. Instalar el servicio

```bash
sudo useradd --system --home /var/lib/cam5-gateway --shell /usr/sbin/nologin cam5gw
sudo mkdir -p /opt/cam5-gateway /etc/cam5-gateway
sudo cp gateway/cam5_gateway.py /opt/cam5-gateway/
sudo cp gateway/deploy/cam5-gateway.service /etc/systemd/system/
```

Crea `/etc/cam5-gateway/gateway.env`, sin comillas alrededor de los valores:

```
CAM5_API_BASE=https://core.hoitlive.com/api/v1
CAM5_GATEWAY_TOKEN=cam5gw_...
```

```bash
sudo chown root:cam5gw /etc/cam5-gateway/gateway.env
sudo chmod 640 /etc/cam5-gateway/gateway.env
```

Antes de dejarlo como servicio, haz un ciclo de prueba:

```bash
sudo -u cam5gw env $(sudo cat /etc/cam5-gateway/gateway.env | xargs) CAM5_STATE_DIR=/tmp/cam5-test CAM5_RUN_ONCE=1 python3 /opt/cam5-gateway/cam5_gateway.py
```

Debe mostrar `accepted <controlador> scheduled` para cada CAM-5. Luego:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cam5-gateway
journalctl -u cam5-gateway -f
```

## 6. Qué hace el gateway

- Al iniciar descarga la configuración (`GET /gateway/config`) y la vuelve a pedir cada 15 minutos. Si el portal no responde, sigue con la copia en `/var/lib/cam5-gateway/config.json`.
- Lee los rangos del perfil: temperatura y ambiente cada 2 s, UHF cada 2 s, diagnóstico cada 10–30 s. Las lecturas se dividen en bloques de 81 registros, que es el máximo del CAM-5.
- Envía los canales habilitados cada minuto y los 105 registros de diagnóstico cada 5 minutos. Si un canal cruza un umbral o se recupera, envía al instante.
- Si un CAM-5 no responde, envía un lote de error (`MODBUS_TIMEOUT` o `MODBUS_CONNECTION`) y el portal lo marca sin comunicación. Al volver, retoma solo.
- Cada lote se guarda en `/var/lib/cam5-gateway/queue` antes de enviarse y se borra cuando el portal lo acepta. Si se cae internet, los lotes esperan y se reenvían en orden; el portal acepta hasta 7 días de atraso. Los lotes que el portal rechaza por formato quedan en `rejected/` para revisión.

## 7. Variables opcionales

| Variable | Uso |
| --- | --- |
| `CAM5_HOST_OVERRIDES` | `CAM5-CHI-01=10.0.0.5:502,CAM5-CHI-02=…` para usar otra IP que la registrada en el portal (NAT o pruebas). |
| `CAM5_REGISTER_OFFSET` | Si las lecturas aparecen corridas en un registro, prueba `-1`. Por defecto es 0: el registro 418 se pide como 418 (0x01A2), según el manual. |
| `CAM5_MAX_READ` | Máximo de registros por lectura (81 por defecto). |
| `CAM5_LOG_LEVEL` | `DEBUG` para ver cada consulta. |

## 8. Probar sin hardware

`gateway/tools/cam5_modbus_simulator.py` emula un CAM-5 por Modbus TCP con el mapa 418–522:

```bash
python3 gateway/tools/cam5_modbus_simulator.py --port 5021 --control control.json
```

Con `control.json` se fuerzan condiciones:

- `{"overrides": {"418": 812}}` pone la barra L1 en 81,2 °C.
- `{"offline": true}` deja el equipo sin responder.

Apunta el gateway al simulador con `CAM5_HOST_OVERRIDES=CAM5-CHI-01=127.0.0.1:5021`.
