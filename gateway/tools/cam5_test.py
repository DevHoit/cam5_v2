#!/usr/bin/env python3
"""Prueba completa de un CAM-5 por Modbus TCP desde el Mac (o cualquier PC).

Solo lee (función 3); nunca escribe en el equipo. No necesita paquetes extra.

    python3 gateway/tools/cam5_test.py 192.168.10.42             # diagnóstico completo
    python3 gateway/tools/cam5_test.py 192.168.10.42 --watch 2   # lectura continua cada 2 s
    python3 gateway/tools/cam5_test.py 192.168.10.42 --csv lectura.csv
    python3 gateway/tools/cam5_test.py 192.168.10.42 --scan-units  # busca Unit ID 1–247
    python3 gateway/tools/cam5_test.py 192.168.10.42 --all       # muestra también canales sin dato

Conexión directa Mac ↔ CAM-5 por cable: dale al Mac una IP de la red del CAM-5
(Ajustes → Red → Ethernet/USB-LAN → Manual, p. ej. 192.168.10.20 / 255.255.255.0).
"""

import argparse
import csv
import datetime
import socket
import struct
import subprocess
import sys
import time

FIRST, LAST, MAX_READ = 418, 522, 81
INT16_ERROR, UINT16_ERROR = 0x8000, 0xFFFF


def build_catalog():
    """Mapa oficial CAM-5 R1.6 §7.1.2: registro → (nombre, tipo, escala, unidad, rango válido)."""
    cat = {}
    for i in range(12):
        cat[418 + i] = (f"Temperatura {i + 1}", "int16", 0.1, "°C", (-50, 167.5))
    for i in range(8):
        cat[430 + 2 * i] = (f"Temp. ambiente {i + 1}", "int16", 0.1, "°C", (-50, 125))
        cat[431 + 2 * i] = (f"Humedad {i + 1}", "uint16", 0.1, "%HR", (0, 100))
    for i in range(4):
        cat[446 + i] = (f"SD{i + 1} total", "uint16", 1, "UHF", None)
        cat[450 + i] = (f"PD{i + 1} total", "uint16", 1, "UHF", None)
        cat[491 + i] = (f"SD{i + 1} conteo", "uint16", 1, "eventos", None)
        cat[495 + i] = (f"PD{i + 1} conteo", "uint16", 1, "eventos", None)
        cat[499 + i] = (f"Alpha SD{i + 1}", "uint16", 1, "UHF", None)
        cat[503 + i] = (f"Alpha PD{i + 1}", "uint16", 1, "UHF", None)
        cat[507 + i] = (f"Beta SD{i + 1}", "uint16", 1, "UHF", None)
        cat[511 + i] = (f"Beta PD{i + 1}", "uint16", 1, "UHF", None)
        cat[515 + i] = (f"Phi SD{i + 1}", "uint16", 1, "UHF", None)
        cat[519 + i] = (f"Phi PD{i + 1}", "uint16", 1, "UHF", None)
    cat[454] = ("Versión de datos", "uint16", 1, "", None)
    for i in range(12):
        cat[455 + 3 * i] = (f"Ruido {i + 1}", "uint16", 1, "UHF", None)
        cat[456 + 3 * i] = (f"Superficial {i + 1}", "uint16", 1, "UHF", None)
        cat[457 + 3 * i] = (f"Interna {i + 1}", "uint16", 1, "UHF", None)
    return cat


CATALOG = build_catalog()
GROUPS = [
    ("Temperaturas SAW (418–429)", range(418, 430)),
    ("Ambiente y humedad (430–445)", range(430, 446)),
    ("Totales UHF (446–453)", range(446, 454)),
    ("Sistema y diagnóstico UHF (454–490)", range(454, 491)),
    ("Conteos y tendencias (491–522)", range(491, 523)),
]

# Colores solo si la salida es una terminal
TTY = sys.stdout.isatty()
def c(code, text): return f"\033[{code}m{text}\033[0m" if TTY else text
OK, WARN, BAD, DIM, BOLD = (lambda t: c("32", t)), (lambda t: c("33", t)), (lambda t: c("31", t)), (lambda t: c("2", t)), (lambda t: c("1", t))

EXCEPTIONS = {1: "función no soportada", 2: "dirección ilegal (¿Base Register distinto de 418?)",
              3: "valor ilegal (¿más de 81 registros?)", 4: "falla del equipo", 10: "gateway sin ruta",
              11: "Unit ID inexistente"}


class ModbusError(Exception):
    pass


class Modbus:
    def __init__(self, host, port, unit, timeout):
        self.host, self.port, self.unit, self.timeout = host, port, unit, timeout
        self.sock, self.tid = None, 0

    def connect(self):
        self.close()
        self.sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
        self.sock.settimeout(self.timeout)

    def close(self):
        if self.sock:
            self.sock.close()
        self.sock = None

    def _recv(self, n):
        data = b""
        while len(data) < n:
            chunk = self.sock.recv(n - len(data))
            if not chunk:
                raise ConnectionError("el CAM-5 cerró la conexión")
            data += chunk
        return data

    def read(self, start, count, function=3):
        """Lee count registros desde start, en bloques de 81 (límite del CAM-5)."""
        values = []
        pos = start
        while pos < start + count:
            n = min(MAX_READ, start + count - pos)
            values += self._read_block(pos, n, function)
            pos += n
        return values

    def _read_block(self, addr, count, function):
        if not self.sock:
            self.connect()
        self.tid = (self.tid + 1) & 0xFFFF
        self.sock.sendall(struct.pack(">HHHBBHH", self.tid, 0, 6, self.unit, function, addr, count))
        while True:
            tid, proto, length, _unit = struct.unpack(">HHHB", self._recv(7))
            body = self._recv(length - 1)
            if tid == self.tid:
                break
        if proto != 0:
            raise ModbusError("trama con protocolo inválido")
        if body[0] == function | 0x80:
            code = body[1]
            raise ModbusError(f"excepción Modbus {code}: {EXCEPTIONS.get(code, 'desconocida')}")
        if body[1] != count * 2:
            raise ModbusError(f"respuesta de {body[1]} bytes, se esperaban {count * 2}")
        return list(struct.unpack(f">{count}H", body[2:2 + count * 2]))


def decode(reg, raw):
    """(valor, estado) con estado: ok, sin_dato, fuera_de_rango."""
    name, dtype, scale, unit, valid = CATALOG[reg]
    if (dtype == "int16" and raw == INT16_ERROR) or (dtype == "uint16" and raw == UINT16_ERROR):
        return None, "sin_dato"
    signed = raw - 0x10000 if dtype == "int16" and raw >= 0x8000 else raw
    value = round(signed * scale, 1) if scale != 1 else signed
    if valid and not (valid[0] <= value <= valid[1]):
        return value, "fuera_de_rango"
    return value, "ok"


def fmt_value(reg, value):
    unit = CATALOG[reg][3]
    return f"{value:.1f} {unit}".strip() if isinstance(value, float) else f"{value} {unit}".strip()


def step(label, ok, detail=""):
    mark = OK("✔") if ok else BAD("✘")
    print(f" {mark} {label}" + (f" — {detail}" if detail else ""))
    return ok


def ping(host):
    try:
        r = subprocess.run(["ping", "-c", "2", "-W", "1000", host], capture_output=True, text=True, timeout=6)
        line = [l for l in r.stdout.splitlines() if "min/avg" in l]
        return r.returncode == 0, (line[0].split("=")[1].split("/")[1] + " ms" if line else "")
    except Exception:
        return False, ""


def read_all(mb, base_offset):
    started = time.monotonic()
    raw = mb.read(FIRST + base_offset, LAST - FIRST + 1)
    return dict(zip(range(FIRST, LAST + 1), raw)), (time.monotonic() - started) * 1000


def print_table(regs, show_all, previous=None):
    for title, rng in GROUPS:
        rows = []
        for reg in rng:
            value, state = decode(reg, regs[reg])
            if state == "sin_dato" and not show_all:
                continue
            changed = previous is not None and previous.get(reg) != regs[reg]
            text = DIM("sin dato") if state == "sin_dato" else fmt_value(reg, value)
            if state == "fuera_de_rango":
                text = WARN(text + "  ⚠ fuera de rango")
            elif changed:
                text = BOLD(text + "  ●")
            rows.append(f"   {reg}  {CATALOG[reg][0]:<22} {text:<20}  {DIM(f'crudo {regs[reg]:5d} 0x{regs[reg]:04X}')}")
        if rows:
            print(BOLD(f"\n {title}"))
            print("\n".join(rows))


def summary(regs):
    states = {reg: decode(reg, raw)[1] for reg, raw in regs.items()}
    temps = [r for r in range(418, 430) if states[r] != "sin_dato"]
    hums = [r for r in range(431, 446, 2) if states[r] != "sin_dato"]
    bad = [r for r, s in states.items() if s == "fuera_de_rango"]
    version = regs[454] if regs[454] != UINT16_ERROR else None
    print(BOLD("\n Resumen"))
    print(f"   Sensores de temperatura con dato: {len(temps)} de 12 {DIM(str([r for r in temps]))}")
    print(f"   Sensores de humedad con dato:     {len(hums)} de 8")
    print(f"   Versión de datos (454):           {version if version is not None else 'sin dato'}")
    if bad:
        print(WARN(f"   Fuera de rango: {', '.join(str(r) for r in bad)}"))
    return not bad


def scan_units(host, port, timeout):
    print(BOLD(f"\n Buscando Unit ID en {host}:{port} (1–247)…"))
    found = []
    for unit in range(1, 248):
        mb = Modbus(host, port, unit, min(timeout, 1.0))
        try:
            mb.read(FIRST, 1)
            found.append(unit)
            print(OK(f"   Unit {unit} responde"))
        except ModbusError as e:
            if "11" not in str(e) and "10" not in str(e):
                print(WARN(f"   Unit {unit}: {e}"))
        except OSError:
            pass
        finally:
            mb.close()
    print(f"   Encontrados: {found or 'ninguno'}")
    return bool(found)


def main():
    p = argparse.ArgumentParser(description="Prueba completa de un CAM-5 por Modbus TCP (solo lectura).")
    p.add_argument("host", help="IP del CAM-5, p. ej. 192.168.10.42")
    p.add_argument("--port", type=int, default=502)
    p.add_argument("--unit", type=int, default=1, help="Unit ID Modbus (1)")
    p.add_argument("--base-offset", type=int, default=0, help="desplazamiento si el Base Register no es 418")
    p.add_argument("--timeout", type=float, default=3.0)
    p.add_argument("--watch", type=float, metavar="SEG", help="lectura continua cada SEG segundos")
    p.add_argument("--csv", metavar="ARCHIVO", help="guarda cada lectura en CSV")
    p.add_argument("--all", action="store_true", help="muestra también los canales sin dato")
    p.add_argument("--scan-units", action="store_true", help="busca qué Unit ID responde")
    args = p.parse_args()

    print(BOLD(f"\nPrueba CAM-5 · {args.host}:{args.port} · Unit {args.unit} · {datetime.datetime.now():%Y-%m-%d %H:%M:%S}\n"))

    reachable, rtt = ping(args.host)
    step("Red: el CAM-5 responde a ping", reachable, rtt or "sin respuesta (puede tener ICMP bloqueado)")

    try:
        t0 = time.monotonic()
        socket.create_connection((args.host, args.port), timeout=args.timeout).close()
        step(f"Puerto Modbus {args.port} abierto", True, f"{(time.monotonic() - t0) * 1000:.0f} ms")
    except OSError as e:
        step(f"Puerto Modbus {args.port} abierto", False, str(e))
        print(WARN("\n Revisa: cable, IP del Mac en la misma red del CAM-5 y que Modbus TCP esté habilitado."))
        return 1

    if args.scan_units:
        return 0 if scan_units(args.host, args.port, args.timeout) else 1

    mb = Modbus(args.host, args.port, args.unit, args.timeout)
    try:
        regs, ms = read_all(mb, args.base_offset)
        step("Lectura 418–522 (105 registros en 2 bloques)", True, f"{ms:.0f} ms")
    except (ModbusError, OSError) as e:
        step("Lectura 418–522", False, str(e))
        if "11" in str(e):
            print(WARN(" Prueba con --scan-units para encontrar el Unit ID correcto."))
        return 1

    writer = None
    if args.csv:
        f = open(args.csv, "w", newline="", encoding="utf-8")
        writer = csv.writer(f)
        writer.writerow(["hora"] + [f"{r} {CATALOG[r][0]}" for r in range(FIRST, LAST + 1)])

    def save(regs):
        if writer:
            row = [datetime.datetime.now().isoformat(timespec="seconds")]
            row += ["" if decode(r, regs[r])[0] is None else decode(r, regs[r])[0] for r in range(FIRST, LAST + 1)]
            writer.writerow(row)
            f.flush()

    print_table(regs, args.all)
    healthy = summary(regs)
    save(regs)

    if args.watch:
        print(DIM(f"\n Lectura continua cada {args.watch} s (● = cambió). Ctrl+C para salir."))
        previous, errors, cycles = regs, 0, 0
        try:
            while True:
                time.sleep(args.watch)
                try:
                    regs, ms = read_all(mb, args.base_offset)
                except (ModbusError, OSError) as e:
                    errors += 1
                    print(BAD(f"\n {datetime.datetime.now():%H:%M:%S} error: {e}"))
                    mb.close()
                    continue
                cycles += 1
                if TTY:
                    print("\033[2J\033[H", end="")
                print(BOLD(f" {datetime.datetime.now():%H:%M:%S} · ciclo {cycles} · {ms:.0f} ms · errores {errors}"))
                print_table(regs, args.all, previous)
                save(regs)
                previous = regs
        except KeyboardInterrupt:
            print(f"\n {cycles} ciclos, {errors} errores.")
    mb.close()
    if writer:
        f.close()
        print(f" CSV guardado en {args.csv}")
    print(OK("\n CAM-5 OK\n") if healthy else WARN("\n CAM-5 responde, con valores fuera de rango\n"))
    return 0 if healthy else 2


if __name__ == "__main__":
    sys.exit(main())
