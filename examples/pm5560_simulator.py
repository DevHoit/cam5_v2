#!/usr/bin/env python3
"""
HOIT PM5560 schema v2 simulator.

Simulates normalized telemetry produced by the future gateway driver. It does
not emulate Modbus registers; register decoding remains a gateway responsibility.

Environment variables:
  HOIT_BASE_URL          e.g. https://portal.example.com
  HOIT_GATEWAY_TOKEN     gateway Bearer token
  HOIT_GATEWAY_CODE      e.g. GW-PM01
  HOIT_DEVICE_CODE       e.g. PM5560-01
  HOIT_INTERVAL          seconds between samples (default: 5)
  HOIT_SCENARIO          normal|undervoltage|overvoltage|overcurrent|low_pf|demo
  HOIT_CYCLES            optional maximum number of cycles; 0 = unlimited
"""

from __future__ import annotations

import json
import math
import os
import random
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone


BASE_URL = os.environ.get("HOIT_BASE_URL", "").rstrip("/")
TOKEN = os.environ.get("HOIT_GATEWAY_TOKEN", "")
GATEWAY_CODE = os.environ.get("HOIT_GATEWAY_CODE", "GW-PM01").upper()
DEVICE_CODE = os.environ.get("HOIT_DEVICE_CODE", "PM5560-01").upper()
INTERVAL = max(1.0, float(os.environ.get("HOIT_INTERVAL", "5")))
SCENARIO = os.environ.get("HOIT_SCENARIO", "normal").strip().lower()
MAX_CYCLES = max(0, int(os.environ.get("HOIT_CYCLES", "0")))
BOOT_ID = str(uuid.uuid4())
SUPPORTED = {"normal", "undervoltage", "overvoltage", "overcurrent", "low_pf", "demo"}


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def post(payload: dict) -> tuple[int, str]:
    request = urllib.request.Request(
        BASE_URL + "/api/v1/gateway/ingest",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": "Bearer " + TOKEN,
            "Content-Type": "application/json",
            "User-Agent": "hoit-pm5560-simulator/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8")
    except urllib.error.URLError as exc:
        return 0, str(exc.reason)


def phase(elapsed: float) -> str:
    if SCENARIO != "demo":
        return SCENARIO
    slot = int(elapsed // 30) % 5
    return ["normal", "undervoltage", "normal", "overcurrent", "low_pf"][slot]


def metrics(elapsed: float, mode: str, energy_import: float) -> tuple[dict, float]:
    wave = math.sin(elapsed / 17.0)
    v1 = 230.0 + wave * 1.8 + random.uniform(-0.5, 0.5)
    v2 = 229.5 + wave * 1.6 + random.uniform(-0.5, 0.5)
    v3 = 230.5 + wave * 1.5 + random.uniform(-0.5, 0.5)
    currents = [
        42.0 + wave * 4.0 + random.uniform(-0.8, 0.8),
        40.0 + wave * 3.5 + random.uniform(-0.8, 0.8),
        43.0 + wave * 3.0 + random.uniform(-0.8, 0.8),
    ]
    pf = 0.96 + random.uniform(-0.01, 0.01)

    if mode == "undervoltage":
        v1 *= 0.78
        v2 *= 0.80
        v3 *= 0.79
    elif mode == "overvoltage":
        v1 *= 1.17
        v2 *= 1.16
        v3 *= 1.18
    elif mode == "overcurrent":
        currents = [value * 2.1 for value in currents]
    elif mode == "low_pf":
        pf = 0.72 + random.uniform(-0.015, 0.015)

    v_avg = (v1 + v2 + v3) / 3.0
    i_avg = sum(currents) / 3.0
    apparent_kw = math.sqrt(3) * (v_avg * math.sqrt(3)) * i_avg / 1000.0
    active_kw = apparent_kw * pf
    reactive_kvar = math.sqrt(max(0.0, apparent_kw ** 2 - active_kw ** 2))
    energy_import += active_kw * INTERVAL / 3600.0
    demand_kw = active_kw * (1.04 + max(0.0, wave) * 0.03)

    return {
        "electrical.voltage.l1_n": round(v1, 2),
        "electrical.voltage.l2_n": round(v2, 2),
        "electrical.voltage.l3_n": round(v3, 2),
        "electrical.voltage.l1_l2": round(v1 * math.sqrt(3), 2),
        "electrical.voltage.l2_l3": round(v2 * math.sqrt(3), 2),
        "electrical.voltage.l3_l1": round(v3 * math.sqrt(3), 2),
        "electrical.current.l1": round(currents[0], 2),
        "electrical.current.l2": round(currents[1], 2),
        "electrical.current.l3": round(currents[2], 2),
        "electrical.power.active.total": round(active_kw, 3),
        "electrical.power.reactive.total": round(reactive_kvar, 3),
        "electrical.power.apparent.total": round(apparent_kw, 3),
        "electrical.power_factor": round(pf, 3),
        "electrical.frequency": round(50.0 + random.uniform(-0.03, 0.03), 3),
        "electrical.energy.import": round(energy_import, 3),
        "electrical.energy.export": 0.0,
        "electrical.demand.active": round(demand_kw, 3),
    }, energy_import


def main() -> int:
    if not BASE_URL or not TOKEN:
        print("HOIT_BASE_URL y HOIT_GATEWAY_TOKEN son obligatorios.", file=sys.stderr)
        return 2
    if SCENARIO not in SUPPORTED:
        print("HOIT_SCENARIO no es válido: " + SCENARIO, file=sys.stderr)
        return 2

    print("HOIT PM5560 simulator")
    print("gateway =", GATEWAY_CODE)
    print("device  =", DEVICE_CODE)
    print("scenario=", SCENARIO)
    print("boot_id =", BOOT_ID)

    started = time.monotonic()
    sequence = 0
    energy_import = 12540.0
    last_mode = ""

    while True:
        elapsed = time.monotonic() - started
        mode = phase(elapsed)
        if mode != last_mode:
            print("phase   =", mode)
            last_mode = mode

        sequence += 1
        sampled_at = iso_now()
        values, energy_import = metrics(elapsed, mode, energy_import)
        payload = {
            "schemaVersion": "2.0",
            "batchKey": f"{GATEWAY_CODE}:{BOOT_ID}:{sequence}:{DEVICE_CODE}",
            "sentAt": iso_now(),
            "sampledAt": sampled_at,
            "timeQuality": "synced",
            "quality": "good",
            "qualityFlags": [],
            "gateway": {
                "code": GATEWAY_CODE,
                "bootId": BOOT_ID,
                "sequence": sequence,
            },
            "device": {
                "code": DEVICE_CODE,
                "driver": "schneider_pm5560",
            },
            "metrics": values,
        }

        status, response = post(payload)
        print(
            sampled_at,
            mode,
            f"V={values['electrical.voltage.l1_n']:.1f}/{values['electrical.voltage.l2_n']:.1f}/{values['electrical.voltage.l3_n']:.1f}",
            f"I={values['electrical.current.l1']:.1f}/{values['electrical.current.l2']:.1f}/{values['electrical.current.l3']:.1f}",
            f"P={values['electrical.power.active.total']:.1f}kW",
            f"PF={values['electrical.power_factor']:.3f}",
            "HTTP", status, response[:160],
        )
        if status in (400, 403, 404, 413, 422):
            print("Error de contrato/configuración; revisa gateway, PM5560 y catálogo de métricas.", file=sys.stderr)
        elif status == 0 or status == 429 or status >= 500:
            print("Error transitorio; el siguiente ciclo continuará.", file=sys.stderr)

        if MAX_CYCLES and sequence >= MAX_CYCLES:
            return 0
        time.sleep(INTERVAL)


if __name__ == "__main__":
    raise SystemExit(main())
