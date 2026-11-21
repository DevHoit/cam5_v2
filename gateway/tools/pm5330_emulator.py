#!/usr/bin/env python3
"""
Emulador de medidores PM5330 para HoitLive Core (por ejemplo, en una Raspberry Pi).

Envía mediciones ya decodificadas a /api/v2/gateway/ingest, igual que lo hará el gateway real que lea
los PM5330 por RS-485. Sirve para ver en el portal empalmes y tableros con datos mientras no hay equipo.

- Solo usa la biblioteca estándar de Python 3 (no requiere pip).
- Cada gateway del archivo de configuración envía sus medidores con su propio token.
- La energía (kWh) se guarda en un archivo de estado, así el contador no retrocede al reiniciar.
- Si no hay red, guarda los envíos pendientes (hasta 2 h) y los reenvía en orden al volver.

Uso:
    python3 pm5330_emulator.py --config emulador.json            # corre en forma continua
    python3 pm5330_emulator.py --config emulador.json --once     # un solo envío (para probar)
    python3 pm5330_emulator.py --config emulador.json --dry-run  # muestra el JSON sin enviarlo

Archivo de configuración (JSON, con permisos 600 porque contiene los tokens):
{
  "url": "https://core.hoitlive.com/api/v2/gateway/ingest",
  "interval_s": 30,
  "gateways": [
    {"code": "HOIT-EMU-INF01", "token": "cam5gw_...", "meters": [{"id": "PM5330-INF", "profile": "infante"}]},
    {"code": "HOIT-EMU-RAN01", "token": "cam5gw_...", "meters": [{"id": "PM5330-RAN", "profile": "rancagua"}]}
  ]
}
Cada medidor puede ajustar su perfil: {"id": "...", "profile": "infante", "base_kw": 300, "pf": 0.95}.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import signal
import sys
import time
import urllib.error
import urllib.request
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone

VERSION = "emulador-pm5330-1.0"

# Perfiles de carga: base nocturna, carga diurna (climatización y operación), punta de mediodía,
# factor de potencia, desbalance entre fases y ajuste de tensión.
PROFILES = {
    # Edificio principal: pabellones, hospitalización y climatización.
    "infante": {"base_kw": 255.0, "day_kw": 175.0, "peak_kw": 35.0, "pf": 0.96, "unbalance": 1.03, "v_offset": 0.0, "energy_kwh": 2_418_560.0},
    # Consultas y atención ambulatoria: más baja de noche.
    "rancagua": {"base_kw": 85.0, "day_kw": 120.0, "peak_kw": 12.0, "pf": 0.94, "unbalance": 1.06, "v_offset": -1.4, "energy_kwh": 1_032_410.0},
    # Tablero genérico.
    "tablero": {"base_kw": 25.0, "day_kw": 30.0, "peak_kw": 6.0, "pf": 0.93, "unbalance": 1.05, "v_offset": 0.0, "energy_kwh": 150_000.0},
}

MAX_PENDING_S = 2 * 3600  # Lo pendiente más antiguo que se reenvía (el portal acepta hasta días atrás).
TIMEZONE_OFFSET_H = -3     # Hora de Chile continental (solo para la forma de la curva diaria).

running = True


def log(message: str) -> None:
    print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} {message}", flush=True)


def local_hour(now: datetime) -> float:
    local = now + timedelta(hours=TIMEZONE_OFFSET_H)
    return local.hour + local.minute / 60


def bell(hour: float, start: float, end: float) -> float:
    return math.sin((hour - start) / (end - start) * math.pi) if start <= hour < end else 0.0


class Meter:
    def __init__(self, spec: dict, state: dict):
        self.id = str(spec["id"]).strip()
        base = PROFILES.get(spec.get("profile", "tablero"))
        if base is None:
            raise ValueError(f"Perfil desconocido para {self.id}: {spec.get('profile')} (usa {', '.join(PROFILES)}).")
        self.p = {**base, **{key: float(value) for key, value in spec.items() if key in base}}
        self.energy = float(state.get(self.id, self.p["energy_kwh"]))
        self.last = time.time()
        self.phase = random.random() * 10

    def read(self, now: datetime) -> dict:
        p, hour = self.p, local_hour(now)
        t = now.timestamp()
        power = (p["base_kw"]
                 + bell(hour, 8, 21) * p["day_kw"]
                 + (p["peak_kw"] if 12 <= hour < 14 else 0.0)
                 + 0.025 * p["base_kw"] * math.sin(t / 1020 + self.phase)
                 + random.gauss(0, 0.012 * p["base_kw"]))
        power = max(1.0, power)
        elapsed_h = max(0.0, t - self.last) / 3600
        self.last = t
        self.energy += power * elapsed_h
        pf = min(0.999, p["pf"] + random.gauss(0, 0.004) - (0.01 if power > p["base_kw"] + p["day_kw"] else 0.0))
        volts = 221.0 + p["v_offset"] - power / 900 + random.gauss(0, 0.4)
        amps = power * 1000 / (3 * volts * pf)
        apparent = power / pf
        return {
            "id": self.id,
            "ts": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "m": {
                "p_kw": round(power, 1),
                "q_kvar": round(math.sqrt(max(0.0, apparent**2 - power**2)), 1),
                "s_kva": round(apparent, 1),
                "e_kwh": round(self.energy, 1),
                "v_l1": round(volts, 1),
                "v_l2": round(volts - 0.9 + random.gauss(0, 0.3), 1),
                "v_l3": round(volts + 0.5 + random.gauss(0, 0.3), 1),
                "i_l1": round(amps * p["unbalance"], 1),
                "i_l2": round(amps, 1),
                "i_l3": round(amps / p["unbalance"], 1),
                "pf": round(pf, 3),
                "hz": round(50 + random.gauss(0, 0.01), 2),
            },
        }


class Gateway:
    def __init__(self, spec: dict, state: dict):
        self.code = str(spec["code"]).strip().upper()
        self.token = str(spec.get("token", "")).strip()
        self.meters = [Meter(meter, state) for meter in spec.get("meters", [])]
        if not self.meters:
            raise ValueError(f"El gateway {self.code} no tiene medidores.")
        self.boot_id = f"emu-{uuid.uuid4().hex[:12]}"
        self.sequence = 0
        self.started = time.time()
        self.pending: deque[tuple[float, dict]] = deque()

    def next_payload(self, now: datetime) -> dict:
        self.sequence += 1
        return {
            "gateway": self.code,
            "sequence": self.sequence,
            "bootId": self.boot_id,
            "health": {"fw": VERSION, "uptimeS": int(time.time() - self.started), "emulated": True},
            "devices": [meter.read(now) for meter in self.meters],
        }


def post(url: str, token: str, payload: dict) -> tuple[int, str]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}", "User-Agent": VERSION},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, response.read(400).decode(errors="replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read(400).decode(errors="replace")


def flush(url: str, gateway: Gateway) -> None:
    """Envía lo pendiente en orden. Un error de red o del servidor deja la cola para el siguiente ciclo."""
    while gateway.pending:
        created, payload = gateway.pending[0]
        if time.time() - created > MAX_PENDING_S:
            gateway.pending.popleft()
            continue
        try:
            status, body = post(url, gateway.token, payload)
        except (urllib.error.URLError, OSError) as error:
            log(f"{gateway.code}: sin conexión ({error}); {len(gateway.pending)} envío(s) pendiente(s).")
            return
        if status in (200, 201, 202):
            gateway.pending.popleft()
            summary = ", ".join(f"{d['id']} {d['m']['p_kw']} kW" for d in payload["devices"])
            log(f"{gateway.code} #{payload['sequence']}: {status} · {summary}")
        elif status in (401, 403, 400, 413, 422):
            # Token, código o formato inválidos: reintentar no lo arregla.
            gateway.pending.popleft()
            log(f"{gateway.code} #{payload['sequence']}: rechazado {status} · {body}")
        else:
            log(f"{gateway.code}: el portal respondió {status}; se reintenta en el próximo ciclo.")
            return


def load_state(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


def save_state(path: str, gateways: list[Gateway]) -> None:
    data = {meter.id: round(meter.energy, 3) for gateway in gateways for meter in gateway.meters}
    temporary = f"{path}.tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(data, handle)
    os.replace(temporary, path)


def stop(*_: object) -> None:
    global running
    running = False


def main() -> int:
    parser = argparse.ArgumentParser(description="Emulador de medidores PM5330 para HoitLive Core.")
    parser.add_argument("--config", required=True, help="Archivo JSON con url, intervalo, gateways, tokens y medidores.")
    parser.add_argument("--state", help="Archivo donde se guarda la energía acumulada (por defecto, junto a la configuración).")
    parser.add_argument("--once", action="store_true", help="Hace un solo envío por gateway y termina.")
    parser.add_argument("--dry-run", action="store_true", help="Muestra el JSON que se enviaría, sin enviarlo.")
    args = parser.parse_args()

    with open(args.config, encoding="utf-8") as handle:
        config = json.load(handle)
    url = config.get("url", "https://core.hoitlive.com/api/v2/gateway/ingest")
    interval = max(10, int(config.get("interval_s", 30)))
    state_path = args.state or os.path.join(os.path.dirname(os.path.abspath(args.config)), "emulador-estado.json")
    state = load_state(state_path)
    gateways = [Gateway(spec, state) for spec in config.get("gateways", [])]
    if not gateways:
        print("La configuración no tiene gateways.", file=sys.stderr)
        return 2
    if not args.dry_run:
        for gateway in gateways:
            if not gateway.token.startswith("cam5gw_"):
                print(f"El gateway {gateway.code} no tiene un token válido (debe empezar con cam5gw_).", file=sys.stderr)
                return 2

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    log(f"{VERSION} · {len(gateways)} gateway(s) · cada {interval} s · {url}")
    while running:
        now = datetime.now(timezone.utc)
        for gateway in gateways:
            payload = gateway.next_payload(now)
            if args.dry_run:
                print(json.dumps(payload, indent=2, ensure_ascii=False))
                continue
            gateway.pending.append((time.time(), payload))
            flush(url, gateway)
        if not args.dry_run:
            save_state(state_path, gateways)
        if args.once or args.dry_run:
            break
        deadline = time.time() + interval
        while running and time.time() < deadline:
            time.sleep(0.5)
    log("Emulador detenido.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
