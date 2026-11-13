#!/usr/bin/env python3
"""Simulador Modbus TCP de un CAM-5 IntelliSAW (mapa R1.6, registros 418–522).

Sirve para probar el gateway sin hardware. Responde como el equipo real:

- Funciones 3 (holding) y 4 (input), que el CAM-5 trata igual.
- Como máximo 81 registros por lectura (manual CAM-5 §7.1.1); más devuelve la excepción 03.
- Direcciones fuera de 418–522 devuelven la excepción 02.
- Sensores no configurados devuelven el código de error del manual (0x8000 o 0xFFFF).

Archivo de control opcional (--control), releído en cada consulta:

    {"offline": false, "overrides": {"418": 812}}

- offline: acepta la conexión pero no responde, como un CAM-5 colgado (el gateway verá timeout).
- overrides: valor crudo fijo por registro; 812 en 418 equivale a 81,2 °C en la barra L1.

Uso:
    python3 gateway/tools/cam5_modbus_simulator.py --port 5021 --name "Equipo 1"
"""

import argparse
import json
import math
import os
import random
import socketserver
import struct
import threading
import time

FIRST_REGISTER = 418
LAST_REGISTER = 522
MAX_REGISTERS_PER_READ = 81
INT16_ERROR = 0x8000
UINT16_ERROR = 0xFFFF


def to_word(value):
    """Convierte un entero con signo a palabra Modbus de 16 bits."""
    return int(value) & 0xFFFF


class Cam5State:
    def __init__(self, temperatures, humidity_sensors, seed, control_path):
        self.temperatures = temperatures
        self.humidity_sensors = humidity_sensors
        self.random = random.Random(seed)
        self.offset = self.random.uniform(-2.0, 2.0)
        self.control_path = control_path
        self.control = {"offline": False, "overrides": {}}
        self.control_mtime = None
        self.started = time.monotonic()
        self.lock = threading.Lock()
        self.counts = [0] * 8

    def reload_control(self):
        if not self.control_path:
            return
        try:
            mtime = os.path.getmtime(self.control_path)
        except OSError:
            self.control = {"offline": False, "overrides": {}}
            self.control_mtime = None
            return
        if mtime == self.control_mtime:
            return
        try:
            with open(self.control_path, encoding="utf-8") as handle:
                data = json.load(handle)
            self.control = {
                "offline": bool(data.get("offline", False)),
                "overrides": {int(key): int(value) for key, value in (data.get("overrides") or {}).items()},
            }
            self.control_mtime = mtime
            print(f"[control] offline={self.control['offline']} overrides={self.control['overrides']}", flush=True)
        except (OSError, ValueError) as error:
            print(f"[control] archivo inválido, se ignora: {error}", flush=True)

    def temperature(self, index, elapsed):
        # Barras L1–L3 más calientes, contactos del interruptor intermedios y cables más fríos.
        if index < 3:
            base = 38.0 + index * 0.8
        elif index < 5:
            base = 44.0 + (index - 3) * 1.5
        else:
            base = 31.0 + (index % 3) * 0.6
        drift = 1.5 * math.sin(elapsed / 300.0 + index)
        return base + self.offset + drift + self.random.uniform(-0.2, 0.2)

    def raw(self, register, elapsed):
        overrides = self.control["overrides"]
        if register in overrides:
            return to_word(overrides[register])
        if 418 <= register <= 429:
            index = register - 418
            if index >= self.temperatures:
                return INT16_ERROR
            return to_word(round(self.temperature(index, elapsed) * 10))
        if 430 <= register <= 445:
            sensor = (register - 430) // 2
            if sensor >= self.humidity_sensors:
                return INT16_ERROR if register % 2 == 0 else UINT16_ERROR
            if register % 2 == 0:
                return to_word(round((23.5 + sensor + 1.2 * math.sin(elapsed / 600.0)) * 10))
            return to_word(round((52.0 + 4.0 * math.sin(elapsed / 900.0) + self.random.uniform(-0.5, 0.5)) * 10))
        if 446 <= register <= 453:
            return self.random.randint(0, 25)
        if register == 454:
            return 1
        if 455 <= register <= 490:
            return self.random.randint(0, 15)
        if 491 <= register <= 498:
            slot = register - 491
            if self.random.random() < 0.05:
                self.counts[slot] = (self.counts[slot] + 1) % 65535
            return self.counts[slot]
        return self.random.randint(0, 20)

    def read(self, start, count):
        with self.lock:
            self.reload_control()
            elapsed = time.monotonic() - self.started
            return [self.raw(register, elapsed) for register in range(start, start + count)]


class ModbusHandler(socketserver.BaseRequestHandler):
    def handle(self):
        state = self.server.cam5_state
        peer = f"{self.client_address[0]}:{self.client_address[1]}"
        print(f"[conexión] {peer}", flush=True)
        while True:
            header = self._receive(7)
            if header is None:
                break
            transaction_id, protocol_id, length, unit_id = struct.unpack(">HHHB", header)
            body = self._receive(length - 1)
            if body is None or protocol_id != 0:
                break
            state.reload_control()
            if state.control["offline"]:
                continue  # Sin respuesta: el cliente debe agotar su timeout.
            function = body[0]
            if function not in (3, 4) or len(body) != 5:
                self._exception(transaction_id, unit_id, function, 1)
                continue
            start, count = struct.unpack(">HH", body[1:5])
            if count < 1 or count > MAX_REGISTERS_PER_READ:
                self._exception(transaction_id, unit_id, function, 3)
                continue
            if start < FIRST_REGISTER or start + count - 1 > LAST_REGISTER:
                self._exception(transaction_id, unit_id, function, 2)
                continue
            values = state.read(start, count)
            payload = struct.pack(">BB", function, count * 2) + b"".join(struct.pack(">H", value) for value in values)
            self.request.sendall(struct.pack(">HHHB", transaction_id, 0, len(payload) + 1, unit_id) + payload)
        print(f"[desconexión] {peer}", flush=True)

    def _receive(self, size):
        data = b""
        while len(data) < size:
            try:
                chunk = self.request.recv(size - len(data))
            except OSError:
                return None
            if not chunk:
                return None
            data += chunk
        return data

    def _exception(self, transaction_id, unit_id, function, code):
        payload = struct.pack(">BB", function | 0x80, code)
        self.request.sendall(struct.pack(">HHHB", transaction_id, 0, len(payload) + 1, unit_id) + payload)


class ThreadedServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5020)
    parser.add_argument("--name", default="CAM-5 simulado")
    parser.add_argument("--temperatures", type=int, default=11, help="sensores SAW configurados (1–12); el resto responde 0x8000")
    parser.add_argument("--humidity-sensors", type=int, default=1, help="sensores de humedad configurados (0–8)")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--control", default=None, help="archivo JSON de control (offline / overrides)")
    args = parser.parse_args()

    state = Cam5State(max(0, min(12, args.temperatures)), max(0, min(8, args.humidity_sensors)), args.seed, args.control)
    with ThreadedServer((args.host, args.port), ModbusHandler) as server:
        server.cam5_state = state
        print(f"{args.name}: Modbus TCP en {args.host}:{args.port} (registros {FIRST_REGISTER}–{LAST_REGISTER})", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
