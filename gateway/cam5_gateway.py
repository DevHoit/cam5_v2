#!/usr/bin/env python3
"""Gateway HoitLive Core para controladores IntelliSAW CAM-5 por Modbus TCP.

Lee uno o varios CAM-5 en la red local y publica en HoitLive Core según
gateway/CAM5_GATEWAY_PROTOCOL.md. Solo usa la biblioteca estándar de Python 3.9+.

Variables de entorno:
  CAM5_API_BASE         URL base de la API, p. ej. https://core.hoitlive.com/api/v1 (obligatoria)
  CAM5_GATEWAY_TOKEN    token del gateway entregado por Provisionamiento (obligatorio)
  CAM5_STATE_DIR        carpeta para configuración local y cola de lotes (por defecto ./cam5-gateway-state)
  CAM5_HOST_OVERRIDES   opcional, CAM5-CTRL-01=127.0.0.1:5021,CAM5-CTRL-02=… para usar otra IP/puerto
                        que la registrada en el portal (pruebas o redes con NAT)
  CAM5_REGISTER_OFFSET  desplazamiento de dirección Modbus (por defecto 0: el registro 418 se pide como 418)
  CAM5_MAX_READ         máximo de registros por lectura (por defecto 81, límite del CAM-5)
  CAM5_RUN_ONCE         1 para hacer un ciclo completo y salir (diagnóstico)
  CAM5_LOG_LEVEL        DEBUG, INFO (por defecto), WARNING
"""

import json
import logging
import os
import signal
import socket
import struct
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

VERSION = "1.0.0"
CONFIG_REFRESH_SECONDS = 15 * 60
RETRY_DELAYS = (2, 5, 15, 30, 60)
RECONNECT_DELAYS = (5, 10, 30, 60)  # espera entre intentos a un CAM-5 que no responde
QUEUE_MAX_AGE = timedelta(days=7)  # el backend rechaza lotes más antiguos
MAX_FLUSH_PER_LOOP = 5
HTTP_TIMEOUT_SECONDS = 10
INT16_ERROR = 0x8000
UINT16_ERROR = 0xFFFF

log = logging.getLogger("cam5-gateway")


def utc_now():
    return datetime.now(timezone.utc)


def iso(moment):
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# Modbus TCP
# ---------------------------------------------------------------------------

class ModbusError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


class ModbusTcpClient:
    """Cliente Modbus TCP mínimo: funciones 3 y 4, con reconexión y reintentos."""

    def __init__(self, host, port, unit_id, timeout_ms, retries, max_read):
        self.host = host
        self.port = port
        self.unit_id = unit_id
        self.timeout = max(0.2, timeout_ms / 1000.0)
        self.retries = max(0, retries)
        self.max_read = max(1, min(125, max_read))
        self.sock = None
        self.transaction_id = 0

    def close(self):
        if self.sock:
            try:
                self.sock.close()
            except OSError:
                pass
        self.sock = None

    def _connect(self):
        if self.sock is None:
            self.sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
            self.sock.settimeout(self.timeout)

    def _receive(self, size):
        data = b""
        while len(data) < size:
            chunk = self.sock.recv(size - len(data))
            if not chunk:
                raise ConnectionError("el controlador cerró la conexión")
            data += chunk
        return data

    def _request(self, function, address, count):
        self.transaction_id = (self.transaction_id + 1) % 0x10000
        pdu = struct.pack(">BHH", function, address, count)
        self.sock.sendall(struct.pack(">HHHB", self.transaction_id, 0, len(pdu) + 1, self.unit_id) + pdu)
        while True:
            transaction_id, protocol_id, length, _unit = struct.unpack(">HHHB", self._receive(7))
            body = self._receive(length - 1)
            if protocol_id != 0:
                raise ConnectionError("respuesta Modbus con protocolo inválido")
            if transaction_id == self.transaction_id:
                break  # descarta respuestas tardías de consultas anteriores
        if body[0] == function | 0x80:
            raise ModbusError(f"MODBUS_EXCEPTION_{body[1]:02d}", f"Excepción Modbus {body[1]} en {address}+{count}")
        if body[0] != function or body[1] != count * 2 or len(body) != 2 + count * 2:
            raise ConnectionError("respuesta Modbus de tamaño inesperado")
        return list(struct.unpack(f">{count}H", body[2:]))

    def read(self, function, start, count, offset=0):
        """Lee `count` registros desde `start` dividiendo en bloques de `max_read`."""
        values = []
        position = start
        while position < start + count:
            size = min(self.max_read, start + count - position)
            values.extend(self._read_block(function, position + offset, size))
            position += size
        return values

    def _read_block(self, function, address, count):
        last_error = None
        for attempt in range(self.retries + 1):
            try:
                self._connect()
                return self._request(function, address, count)
            except ModbusError:
                raise  # el equipo respondió: reintentar no cambia nada
            except socket.timeout as error:
                last_error = ModbusError("MODBUS_TIMEOUT", f"Sin respuesta de {self.host}:{self.port} después de {attempt + 1} intento(s)")
                log.debug("timeout: %s", error)
            except OSError as error:
                last_error = ModbusError("MODBUS_CONNECTION", f"No fue posible comunicarse con {self.host}:{self.port}: {error}")
            self.close()
        raise last_error


# ---------------------------------------------------------------------------
# API HoitLive Core y cola local
# ---------------------------------------------------------------------------

class ApiClient:
    def __init__(self, base_url, token):
        self.base_url = base_url.rstrip("/")
        self.token = token

    def call(self, path, method="GET", payload=None):
        data = None if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            self.base_url + path,
            data=data,
            method=method,
            headers={
                "Authorization": "Bearer " + self.token,
                "Content-Type": "application/json",
                "User-Agent": f"HoitLive-CAM5-Gateway/{VERSION}",
            },
        )
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            return response.status, json.loads(response.read().decode("utf-8") or "{}")


class BatchQueue:
    """Cola persistente: cada lote se guarda antes de enviarse y se borra al ser aceptado."""

    def __init__(self, directory):
        self.directory = Path(directory) / "queue"
        self.rejected = Path(directory) / "rejected"
        self.directory.mkdir(parents=True, exist_ok=True)
        self.rejected.mkdir(parents=True, exist_ok=True)
        self.retry_index = 0
        self.next_attempt = 0.0

    def put(self, payload):
        name = f"{time.time_ns():020d}-{payload['gateway']['sequence']:010d}.json"
        temporary = self.directory / (name + ".tmp")
        temporary.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        temporary.replace(self.directory / name)

    def size(self):
        return sum(1 for _ in self.directory.glob("*.json"))

    def flush(self, api):
        """Envía en orden los lotes pendientes. Devuelve las respuestas aceptadas."""
        accepted = []
        if time.monotonic() < self.next_attempt:
            return accepted
        for path in sorted(self.directory.glob("*.json"))[:MAX_FLUSH_PER_LOOP]:
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                path.replace(self.rejected / path.name)
                continue
            sent_at = datetime.fromisoformat(payload["poll"]["completedAt"].replace("Z", "+00:00"))
            if utc_now() - sent_at > QUEUE_MAX_AGE:
                log.warning("Lote %s excede 7 días; se archiva sin enviar", payload["batchKey"])
                path.replace(self.rejected / path.name)
                continue
            payload["sentAt"] = iso(utc_now())
            try:
                status, response = api.call("/gateway/ingest", "POST", payload)
            except urllib.error.HTTPError as error:
                detail = error.read().decode("utf-8", errors="replace")[:500]
                if 400 <= error.code < 500 and error.code not in (409, 429):
                    log.error("Lote %s rechazado (%s): %s", payload["batchKey"], error.code, detail)
                    path.replace(self.rejected / path.name)
                    continue
                self._backoff(f"HTTP {error.code}: {detail}")
                break
            except (OSError, ValueError) as error:
                self._backoff(str(error))
                break
            if status in (200, 202):
                path.unlink(missing_ok=True)
                self.retry_index = 0
                accepted.append((payload, response))
            else:
                self._backoff(f"respuesta inesperada {status}")
                break
        return accepted

    def _backoff(self, reason):
        delay = RETRY_DELAYS[min(self.retry_index, len(RETRY_DELAYS) - 1)]
        self.retry_index += 1
        self.next_attempt = time.monotonic() + delay
        log.warning("Envío pendiente (%s lotes en cola); reintento en %ss: %s", self.size(), delay, reason)


# ---------------------------------------------------------------------------
# Controladores
# ---------------------------------------------------------------------------

def decode(raw, definition):
    """Valor de ingeniería según el catálogo, o None si es un código de error."""
    if raw == definition.get("errorRawValue"):
        return None
    if definition.get("dataType") == "int16" and raw >= 0x8000:
        raw -= 0x10000
    return raw * float(definition.get("scaleFactor") or 1)


class DeviceRuntime:
    def __init__(self, gateway, config, settings):
        self.gateway = gateway
        self.config = config
        self.code = config["code"]
        host, port = config["host"], int(config["port"])
        override = settings["host_overrides"].get(self.code)
        if override:
            host, _, override_port = override.partition(":")
            port = int(override_port or port)
        self.client = ModbusTcpClient(host, port, int(config["unitId"]), int(config.get("timeoutMs") or 1000), int(config.get("retries") or 2), settings["max_read"])
        self.offset = settings["register_offset"]
        self.ranges = [item for item in config.get("ranges", []) if item.get("enabled", True) and item.get("functionCode", 3) in (3, 4)]
        self.definitions = {item["register"]: item for item in config.get("registers", [])}
        self.channels = [item for item in config.get("channels", []) if item.get("enabled", True)]
        self.operational = sorted({item["register"] for item in self.channels if item["register"] in self.definitions})
        policy = config.get("uploadPolicy") or {}
        self.storage_seconds = policy.get("normalIntervalMs", 60_000) / 1000.0
        self.diagnostic_seconds = policy.get("diagnosticIntervalMs", 300_000) / 1000.0
        self.cache = {}
        self.next_poll = {item["name"]: 0.0 for item in self.ranges}
        self.next_storage = 0.0
        self.next_diagnostic = time.monotonic() + min(30.0, self.diagnostic_seconds)
        self.alarm_states = {}
        self.last_state_upload = 0.0
        self.failure = None
        self.failure_count = 0
        self.next_reconnect = 0.0
        self.next_error_report = 0.0
        self.latencies = []
        log.info("Controlador %s → %s:%s Unit %s (%s canales operativos)", self.code, self.client.host, self.client.port, self.client.unit_id, len(self.operational))

    def poll(self, now):
        """Lee los rangos vencidos. Devuelve un lote de error si el controlador dejó de responder."""
        if self.failure and now < self.next_reconnect:
            return None  # no bloquear al resto de los equipos con timeouts repetidos
        for item in self.ranges:
            if now < self.next_poll[item["name"]]:
                continue
            self.next_poll[item["name"]] = now + item["intervalMs"] / 1000.0
            start, end = item["startRegister"], item["endRegister"]
            started = utc_now()
            began = time.monotonic()
            try:
                values = self.client.read(item.get("functionCode", 3), start, end - start + 1, self.offset)
            except ModbusError as error:
                return self._register_failure(item, error, started)
            completed = utc_now()
            self.latencies = (self.latencies + [int((time.monotonic() - began) * 1000)])[-20:]
            for register, raw in zip(range(start, end + 1), values):
                self.cache[register] = {"raw": raw, "started": started, "recorded": completed}
            if self.failure:
                log.info("%s volvió a responder después de %s intento(s) fallido(s)", self.code, self.failure_count)
                self.failure = None
                self.failure_count = 0
        return None

    def _register_failure(self, item, error, started):
        first = self.failure is None
        self.failure = error
        self.failure_count += 1
        delay = RECONNECT_DELAYS[min(self.failure_count - 1, len(RECONNECT_DELAYS) - 1)]
        self.next_reconnect = time.monotonic() + delay
        if first:
            log.warning("%s sin comunicación: %s (%s); reintento cada %s–%ss", self.code, error.message, item["name"], RECONNECT_DELAYS[0], RECONNECT_DELAYS[-1])
        else:
            log.debug("%s sigue sin responder (intento %s): %s", self.code, self.failure_count, error.message)
        if not first and time.monotonic() < self.next_error_report:
            return None
        self.next_error_report = time.monotonic() + self.storage_seconds
        expected = item["endRegister"] - item["startRegister"] + 1
        return self._payload("error", [], started, utc_now(), expected, {"code": error.code, "message": error.message[:500]})

    def due_batch(self, now):
        if self.failure or not self.cache:
            return None
        states = self._alarm_states()
        changed = bool(self.alarm_states) and states != self.alarm_states and now - self.last_state_upload >= 30
        self.alarm_states = states
        if changed:
            self.last_state_upload = now
            self.next_storage = now + self.storage_seconds  # el portal difiere envíos programados muy seguidos
            trigger = "alarm" if any(state != "normal" for state in states.values()) else "recovery"
            return self._batch(trigger, self.operational)
        if now >= self.next_diagnostic:
            self.next_diagnostic = now + self.diagnostic_seconds
            return self._batch("diagnostic", sorted(self.definitions))
        if now >= self.next_storage and self.operational:
            self.next_storage = now + self.storage_seconds
            return self._batch("scheduled", self.operational)
        return None

    def _alarm_states(self):
        states = {}
        for channel in self.channels:
            entry = self.cache.get(channel["register"])
            definition = self.definitions.get(channel["register"])
            if not entry or not definition:
                continue
            value = decode(entry["raw"], definition)
            if value is None:
                states[channel["register"]] = "unavailable"
                continue
            warning, critical = channel.get("warningThreshold"), channel.get("criticalThreshold")
            states[channel["register"]] = "critical" if critical is not None and value >= critical else "warning" if warning is not None and value >= warning else "normal"
        return states

    def _batch(self, trigger, registers):
        selected = [register for register in registers if register in self.cache]
        if not selected:
            return None
        entries = [self.cache[register] for register in selected]
        readings = [{"register": register, "rawValue": self.cache[register]["raw"], "recordedAt": iso(self.cache[register]["recorded"]), "quality": "good", "flags": []} for register in selected]
        return self._payload(trigger, readings, min(item["started"] for item in entries), max(item["recorded"] for item in entries), len(readings))

    def _payload(self, trigger, readings, started, completed, expected, error=None):
        sequence = self.gateway.next_sequence()
        data_version = self.cache.get(454, {}).get("raw")
        device = {"code": self.code, "unitId": self.client.unit_id}
        if data_version is not None and data_version != UINT16_ERROR:
            device["dataVersion"] = data_version
        poll = {"startedAt": iso(started), "completedAt": iso(max(completed, started)), "expectedRegisters": max(1, expected)}
        if self.latencies:
            poll["latencyMs"] = int(sum(self.latencies) / len(self.latencies))
        if error:
            poll["error"] = error
        for reading in readings:
            reading["sequence"] = sequence
        return {
            "schemaVersion": "1.0",
            "trigger": trigger,
            "batchKey": f"{self.gateway.boot_id}:{self.code}:{trigger}:{sequence}",
            "sentAt": iso(utc_now()),
            "gateway": {"code": self.gateway.code, "bootId": self.gateway.boot_id, "sequence": sequence, "uptimeSeconds": self.gateway.uptime()},
            "device": device,
            "poll": poll,
            "readings": readings,
        }

    def close(self):
        self.client.close()


class Gateway:
    def __init__(self, settings):
        self.settings = settings
        self.api = ApiClient(settings["api_base"], settings["token"])
        self.state_dir = Path(settings["state_dir"])
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.queue = BatchQueue(self.state_dir)
        self.boot_id = str(uuid.uuid4())
        self.started = time.monotonic()
        self.sequence = 0
        self.code = None
        self.devices = []
        self.config_checksum = None
        self.next_config = 0.0
        self.next_heartbeat = 0.0
        self.heartbeat_seconds = 30.0
        self.running = True

    def next_sequence(self):
        self.sequence += 1
        return self.sequence

    def uptime(self):
        return int(time.monotonic() - self.started)

    def load_configuration(self):
        cache = self.state_dir / "config.json"
        try:
            _, configuration = self.api.call("/gateway/config")
            temporary = cache.with_suffix(".tmp")
            temporary.write_text(json.dumps(configuration), encoding="utf-8")
            temporary.replace(cache)
        except (OSError, ValueError, urllib.error.HTTPError) as error:
            if not cache.exists():
                raise SystemExit(f"No fue posible obtener la configuración y no hay copia local: {error}")
            log.warning("Sin acceso a la configuración remota (%s); se usa la copia local", error)
            configuration = json.loads(cache.read_text(encoding="utf-8"))
        checksum = json.dumps([(item["code"], item["host"], item["port"], item["unitId"], (item.get("configuration") or {}).get("checksumSha256"), item.get("ranges"), item.get("channels")) for item in configuration["devices"]], sort_keys=True)
        if checksum == self.config_checksum:
            return
        for device in self.devices:
            device.close()
        self.code = configuration["gateway"]["code"]
        self.devices = [DeviceRuntime(self, item, self.settings) for item in configuration["devices"]]
        self.config_checksum = checksum
        policies = [item.get("uploadPolicy") or {} for item in configuration["devices"]]
        self.heartbeat_seconds = min([policy.get("heartbeatIntervalMs", 30_000) for policy in policies] or [30_000]) / 1000.0
        if not self.devices:
            log.warning("El gateway %s no tiene controladores asignados en el portal", self.code)
        log.info("Configuración aplicada: gateway %s, %s controlador(es)", self.code, len(self.devices))

    def heartbeat(self):
        try:
            _, response = self.api.call("/gateway/heartbeat", "POST", {})
            self.heartbeat_seconds = response.get("nextHeartbeatInMs", self.heartbeat_seconds * 1000) / 1000.0
        except (OSError, ValueError, urllib.error.HTTPError) as error:
            log.warning("Heartbeat fallido: %s", error)

    def run(self):
        run_once = self.settings["run_once"]
        while self.running:
            now = time.monotonic()
            if now >= self.next_config:
                self.load_configuration()
                self.next_config = now + CONFIG_REFRESH_SECONDS
            if now >= self.next_heartbeat:
                self.heartbeat()
                self.next_heartbeat = now + self.heartbeat_seconds
            for device in self.devices:
                error_batch = device.poll(now)
                if error_batch:
                    self.queue.put(error_batch)
                batch = device.due_batch(now)
                if batch:
                    self.queue.put(batch)
            for payload, response in self.queue.flush(self.api):
                log.info("%s %s %s: %s registro(s)", response.get("status"), payload["device"]["code"], payload["trigger"], response.get("accepted", 0))
                # El portal mide el intervalo desde que recibió el lote; seguir su indicación evita envíos «deferred».
                if payload["trigger"] in ("scheduled", "alarm", "recovery") and response.get("nextUploadInMs"):
                    for device in self.devices:
                        if device.code == payload["device"]["code"]:
                            device.next_storage = time.monotonic() + response["nextUploadInMs"] / 1000.0
            if run_once:
                break
            time.sleep(0.2)
        for device in self.devices:
            device.close()

    def stop(self, *_):
        log.info("Deteniendo gateway…")
        self.running = False


def parse_host_overrides(value):
    """Acepta `CODIGO=ip:puerto,CODIGO=ip:puerto` (apto para .env y systemd) o un objeto JSON."""
    value = value.strip()
    if not value:
        return {}
    if value.startswith("{"):
        try:
            return {str(key): str(target) for key, target in json.loads(value).items()}
        except ValueError as error:
            raise SystemExit(f"CAM5_HOST_OVERRIDES no es JSON válido: {error}")
    overrides = {}
    for item in value.split(","):
        code, separator, target = item.strip().partition("=")
        if not separator or not code.strip() or not target.strip():
            raise SystemExit(f"CAM5_HOST_OVERRIDES: entrada inválida «{item}»; usa CODIGO=ip:puerto")
        overrides[code.strip()] = target.strip()
    return overrides


def settings_from_environment():
    api_base = os.environ.get("CAM5_API_BASE", "").strip()
    token = os.environ.get("CAM5_GATEWAY_TOKEN", "").strip()
    if not api_base or not token:
        raise SystemExit("Configura CAM5_API_BASE y CAM5_GATEWAY_TOKEN antes de iniciar.")
    overrides = parse_host_overrides(os.environ.get("CAM5_HOST_OVERRIDES", ""))
    return {
        "api_base": api_base,
        "token": token,
        "state_dir": os.environ.get("CAM5_STATE_DIR", "./cam5-gateway-state"),
        "host_overrides": overrides,
        "register_offset": int(os.environ.get("CAM5_REGISTER_OFFSET", "0")),
        "max_read": int(os.environ.get("CAM5_MAX_READ", "81")),
        "run_once": os.environ.get("CAM5_RUN_ONCE", "").lower() in ("1", "true", "yes"),
    }


def main():
    logging.basicConfig(level=os.environ.get("CAM5_LOG_LEVEL", "INFO").upper(), format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
    gateway = Gateway(settings_from_environment())
    signal.signal(signal.SIGTERM, gateway.stop)
    signal.signal(signal.SIGINT, gateway.stop)
    log.info("HoitLive CAM5 Gateway %s (boot %s)", VERSION, gateway.boot_id)
    gateway.run()


if __name__ == "__main__":
    main()
