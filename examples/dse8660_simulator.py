#!/usr/bin/env python3
"""
HOIT DSE8660 MKII schema v2 simulator.

Simulates normalized ATS telemetry produced by the future gateway driver.
It does not emulate DSE GenComm/Modbus registers; register decoding remains
a gateway responsibility and must be implemented from the verified DSE map.

Environment variables:
  HOIT_BASE_URL          e.g. https://portal.example.com
  HOIT_GATEWAY_TOKEN     gateway Bearer token
  HOIT_GATEWAY_CODE      e.g. GW-DSE
  HOIT_DEVICES           comma-separated controller codes (default DSE8660-01,DSE8660-02)
  HOIT_INTERVAL          seconds between cycles (default 5)
  HOIT_SCENARIO          normal|source1_fail|source2_fail|transfer_to_source2|common_alarm|demo
  HOIT_CYCLES            optional maximum number of cycles; 0 = unlimited
  HOIT_PHASE_SECONDS     demo phase duration (default 25)
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
GATEWAY_CODE = os.environ.get("HOIT_GATEWAY_CODE", "GW-DSE").upper()
DEVICES = [item.strip().upper() for item in os.environ.get("HOIT_DEVICES", "DSE8660-01,DSE8660-02").split(",") if item.strip()]
INTERVAL = max(1.0, float(os.environ.get("HOIT_INTERVAL", "5")))
SCENARIO = os.environ.get("HOIT_SCENARIO", "normal").strip().lower()
MAX_CYCLES = max(0, int(os.environ.get("HOIT_CYCLES", "0")))
PHASE_SECONDS = max(INTERVAL * 2, float(os.environ.get("HOIT_PHASE_SECONDS", "25")))
BOOT_ID = str(uuid.uuid4())
SUPPORTED = {"normal", "source1_fail", "source2_fail", "transfer_to_source2", "common_alarm", "demo"}


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
            "User-Agent": "hoit-dse8660-simulator/1.0",
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
    slot = int(elapsed // PHASE_SECONDS) % 6
    return [
        "normal",
        "source1_fail",
        "transfer_to_source2",
        "common_alarm",
        "normal",
        "source2_fail",
    ][slot]


def source_voltages(base: float, available: bool, elapsed: float, offset: float) -> tuple[float, float, float]:
    if not available:
        return 0.0, 0.0, 0.0
    wave = math.sin(elapsed / 19.0 + offset)
    return (
        base + wave * 1.2 + random.uniform(-0.35, 0.35),
        base - 0.6 + wave * 1.0 + random.uniform(-0.35, 0.35),
        base + 0.5 + wave * 0.9 + random.uniform(-0.35, 0.35),
    )


def metrics(device_index: int, elapsed: float, mode: str) -> dict:
    source1_available = mode not in {"source1_fail", "transfer_to_source2"}
    source2_available = mode != "source2_fail"

    position = "source2" if mode == "transfer_to_source2" else "source1"
    breaker1 = position == "source1" and source1_available
    breaker2 = position == "source2" and source2_available
    common_alarm = mode == "common_alarm"

    s1 = source_voltages(230.0, source1_available, elapsed, device_index * 0.2)
    s2 = source_voltages(229.5, source2_available, elapsed, device_index * 0.3)

    source1_hz = 0.0 if not source1_available else 50.0 + random.uniform(-0.025, 0.025)
    source2_hz = 0.0 if not source2_available else 50.0 + random.uniform(-0.035, 0.035)

    load_base = 36.0 + device_index * 7.0
    wave = math.sin(elapsed / 23.0 + device_index)
    currents = [
        load_base + wave * 3.2 + random.uniform(-0.6, 0.6),
        load_base - 1.5 + wave * 2.7 + random.uniform(-0.6, 0.6),
        load_base + 1.2 + wave * 2.5 + random.uniform(-0.6, 0.6),
    ]
    pf = 0.95 + random.uniform(-0.012, 0.012)
    selected = s2 if position == "source2" else s1
    phase_voltage = sum(selected) / 3 if any(selected) else 0.0
    apparent_kva = math.sqrt(3) * (phase_voltage * math.sqrt(3)) * (sum(currents) / 3) / 1000.0
    active_kw = apparent_kva * pf
    reactive_kvar = math.sqrt(max(0.0, apparent_kva ** 2 - active_kw ** 2))

    return {
        "ats.source1.voltage.l1_n": round(s1[0], 2),
        "ats.source1.voltage.l2_n": round(s1[1], 2),
        "ats.source1.voltage.l3_n": round(s1[2], 2),
        "ats.source1.voltage.l1_l2": round(s1[0] * math.sqrt(3), 2),
        "ats.source1.voltage.l2_l3": round(s1[1] * math.sqrt(3), 2),
        "ats.source1.voltage.l3_l1": round(s1[2] * math.sqrt(3), 2),
        "ats.source1.frequency": round(source1_hz, 3),
        "ats.source2.voltage.l1_n": round(s2[0], 2),
        "ats.source2.voltage.l2_n": round(s2[1], 2),
        "ats.source2.voltage.l3_n": round(s2[2], 2),
        "ats.source2.voltage.l1_l2": round(s2[0] * math.sqrt(3), 2),
        "ats.source2.voltage.l2_l3": round(s2[1] * math.sqrt(3), 2),
        "ats.source2.voltage.l3_l1": round(s2[2] * math.sqrt(3), 2),
        "ats.source2.frequency": round(source2_hz, 3),
        "ats.load.current.l1": round(currents[0], 2),
        "ats.load.current.l2": round(currents[1], 2),
        "ats.load.current.l3": round(currents[2], 2),
        "ats.load.power.active.total": round(active_kw, 3),
        "ats.load.power.reactive.total": round(reactive_kvar, 3),
        "ats.load.power.apparent.total": round(apparent_kva, 3),
        "ats.load.power_factor": round(pf, 3),
        "ats.source1.available": source1_available,
        "ats.source2.available": source2_available,
        "ats.breaker.source1_closed": breaker1,
        "ats.breaker.source2_closed": breaker2,
        "ats.transfer.position": position,
        "ats.common_alarm": common_alarm,
        "ats.active_alarm_count": 1 if common_alarm else 0,
        "dse.mode": "auto",
    }


def main() -> int:
    if not BASE_URL or not TOKEN:
        print("HOIT_BASE_URL y HOIT_GATEWAY_TOKEN son obligatorios.", file=sys.stderr)
        return 2
    if not DEVICES:
        print("HOIT_DEVICES debe contener al menos un DSE8660.", file=sys.stderr)
        return 2
    if SCENARIO not in SUPPORTED:
        print("HOIT_SCENARIO no es válido: " + SCENARIO, file=sys.stderr)
        return 2

    print("HOIT DSE8660 MKII simulator")
    print("gateway =", GATEWAY_CODE)
    print("devices =", ", ".join(DEVICES))
    print("scenario=", SCENARIO)
    print("boot_id =", BOOT_ID)
    if SCENARIO == "demo":
        print("demo    =", f"cambia de fase cada {PHASE_SECONDS:g}s")

    started = time.monotonic()
    gateway_sequence = 0
    cycle = 0
    last_phase = ""

    while True:
        elapsed = time.monotonic() - started
        current_phase = phase(elapsed)
        if current_phase != last_phase:
            print("phase   =", current_phase)
            last_phase = current_phase

        cycle += 1
        sampled_at = iso_now()
        for index, device in enumerate(DEVICES):
            gateway_sequence += 1
            values = metrics(index, elapsed, current_phase)
            payload = {
                "schemaVersion": "2.0",
                "batchKey": f"{GATEWAY_CODE}:{BOOT_ID}:{gateway_sequence}:{device}",
                "sentAt": iso_now(),
                "sampledAt": sampled_at,
                "timeQuality": "synced",
                "quality": "good",
                "qualityFlags": [],
                "gateway": {
                    "code": GATEWAY_CODE,
                    "bootId": BOOT_ID,
                    "sequence": gateway_sequence,
                },
                "device": {
                    "code": device,
                },
                "metrics": values,
            }

            status, response = post(payload)
            print(
                sampled_at,
                current_phase,
                device,
                f"F1={'OK' if values['ats.source1.available'] else 'NO'}",
                f"F2={'OK' if values['ats.source2.available'] else 'NO'}",
                f"POS={values['ats.transfer.position']}",
                f"P={values['ats.load.power.active.total']:.1f}kW",
                f"ALM={values['ats.active_alarm_count']}",
                "HTTP", status, response[:160],
            )
            if status in (400, 403, 404, 413, 422):
                print("Error de contrato/configuración; revisa gateway, DSE8660 y catálogo de métricas.", file=sys.stderr)
            elif status == 0 or status == 429 or status >= 500:
                print("Error transitorio; el siguiente ciclo continuará.", file=sys.stderr)

        if MAX_CYCLES and cycle >= MAX_CYCLES:
            print("Se alcanzó HOIT_CYCLES =", MAX_CYCLES)
            return 0
        time.sleep(INTERVAL)


if __name__ == "__main__":
    raise SystemExit(main())
