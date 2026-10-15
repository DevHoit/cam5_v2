#!/usr/bin/env python3
"""
HOIT Cold Chain schema v2 simulator.

Development tool for validating the complete cold-chain flow before the
embedded gateway implementation is ready.

Environment variables:
  HOIT_BASE_URL          e.g. https://preview-url.vercel.app
  HOIT_GATEWAY_TOKEN     gateway Bearer token
  HOIT_GATEWAY_CODE      e.g. GW-TEMP-01
  HOIT_DEVICES           comma-separated device codes
  HOIT_INTERVAL          seconds between cycles (default: 5)
  HOIT_SCENARIO          normal|high|low|battery|disagreement|demo (default: normal)
  HOIT_MIN_C             configured minimum used by scenarios (default: 2)
  HOIT_MAX_C             configured maximum used by scenarios (default: 8)
  HOIT_TARGET_C          nominal target (default: 5)
  HOIT_ALARM_DELAY       expected excursion delay in seconds (default: 300)
  HOIT_WARMUP_SECONDS    normal phase for demo (default: 15)
  HOIT_RECOVERY_SECONDS  recovery phase for demo (default: 30)
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
GATEWAY_CODE = os.environ.get("HOIT_GATEWAY_CODE", "GW-TEMP-01").upper()
DEVICES = [item.strip().upper() for item in os.environ.get("HOIT_DEVICES", "TEMP-01,TEMP-02").split(",") if item.strip()]
INTERVAL = max(1.0, float(os.environ.get("HOIT_INTERVAL", "5")))
SCENARIO = os.environ.get("HOIT_SCENARIO", "normal").strip().lower()
MIN_C = float(os.environ.get("HOIT_MIN_C", "2"))
MAX_C = float(os.environ.get("HOIT_MAX_C", "8"))
TARGET_C = float(os.environ.get("HOIT_TARGET_C", "5"))
ALARM_DELAY = max(1.0, float(os.environ.get("HOIT_ALARM_DELAY", "300")))
WARMUP_SECONDS = max(0.0, float(os.environ.get("HOIT_WARMUP_SECONDS", "15")))
RECOVERY_SECONDS = max(0.0, float(os.environ.get("HOIT_RECOVERY_SECONDS", "30")))
MAX_CYCLES = max(0, int(os.environ.get("HOIT_CYCLES", "0")))
BOOT_ID = str(uuid.uuid4())
SUPPORTED_SCENARIOS = {"normal", "high", "low", "battery", "disagreement", "demo"}


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def post(payload: dict) -> tuple[int, str]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        BASE_URL + "/api/v1/gateway/ingest",
        data=body,
        method="POST",
        headers={
            "Authorization": "Bearer " + TOKEN,
            "Content-Type": "application/json",
            "User-Agent": "hoit-cold-chain-simulator/2.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8")
    except urllib.error.URLError as exc:
        return 0, str(exc.reason)


def nominal_temperature(device_index: int, elapsed: float) -> float:
    slow_cycle = math.sin(elapsed / 120.0 + device_index) * 0.25
    noise = random.uniform(-0.08, 0.08)
    offset = device_index * 0.12
    return round(TARGET_C + offset + slow_cycle + noise, 2)


def scenario_phase(elapsed: float) -> str:
    if SCENARIO != "demo":
        return SCENARIO
    if elapsed < WARMUP_SECONDS:
        return "normal"
    if elapsed < WARMUP_SECONDS + ALARM_DELAY + max(INTERVAL * 2, 10):
        return "high"
    if elapsed < WARMUP_SECONDS + ALARM_DELAY + max(INTERVAL * 2, 10) + RECOVERY_SECONDS:
        return "normal"
    return "done"


def simulated_temperature(device_index: int, elapsed: float, phase: str) -> float:
    if phase == "high":
        return round(MAX_C + 2.0 + device_index * 0.15, 2)
    if phase == "low":
        return round(MIN_C - 2.0 - device_index * 0.15, 2)
    if phase == "disagreement" and len(DEVICES) > 1:
        return round(TARGET_C if device_index == 0 else TARGET_C + 3.0 + device_index * 0.2, 2)
    return nominal_temperature(device_index, elapsed)


def simulated_battery(phase: str, elapsed: float) -> float:
    if phase == "battery":
        return 2.95
    return round(3.58 - elapsed / 10_000_000, 3)


def main() -> int:
    if not BASE_URL or not TOKEN:
        print("HOIT_BASE_URL y HOIT_GATEWAY_TOKEN son obligatorios.", file=sys.stderr)
        return 2
    if not DEVICES:
        print("HOIT_DEVICES debe contener al menos un sensor.", file=sys.stderr)
        return 2
    if SCENARIO not in SUPPORTED_SCENARIOS:
        print("HOIT_SCENARIO no es válido: " + SCENARIO, file=sys.stderr)
        return 2
    if MIN_C >= MAX_C:
        print("HOIT_MIN_C debe ser menor que HOIT_MAX_C.", file=sys.stderr)
        return 2

    print("HOIT Cold Chain simulator v2")
    print("base_url =", BASE_URL)
    print("gateway  =", GATEWAY_CODE)
    print("devices  =", ", ".join(DEVICES))
    print("scenario =", SCENARIO)
    print("range    =", f"{MIN_C}..{MAX_C} °C target={TARGET_C} °C")
    print("boot_id  =", BOOT_ID)
    if SCENARIO == "demo":
        print("demo     =", f"normal {WARMUP_SECONDS}s -> high >= {ALARM_DELAY}s -> recovery {RECOVERY_SECONDS}s")

    started = time.monotonic()
    sequence = 0
    advertising_counts = {device: random.randint(10_000, 50_000) for device in DEVICES}
    last_phase = ""

    while True:
        elapsed = time.monotonic() - started
        phase = scenario_phase(elapsed)
        if phase == "done":
            print("Demo completada. Revisa Resumen, Histórico, Excursiones, Alarmas y Reportes.")
            return 0
        if phase != last_phase:
            print("phase    =", phase)
            last_phase = phase

        sequence += 1
        sampled_at = iso_now()

        for index, device in enumerate(DEVICES):
            advertising_counts[device] += random.randint(3, 8)
            temperature = simulated_temperature(index, elapsed, phase)
            battery = simulated_battery(phase, elapsed)
            payload = {
                "schemaVersion": "2.0",
                "batchKey": f"{GATEWAY_CODE}:{BOOT_ID}:{sequence}:{device}",
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
                    "code": device,
                },
                "metrics": {
                    "environment.temperature": temperature,
                    "sensor.battery_voltage": battery,
                    "sensor.rssi": random.randint(-76, -58),
                    "sensor.adv_count": advertising_counts[device],
                },
            }

            status, response = post(payload)
            print(sampled_at, phase, device, f"{temperature:.2f}C", f"{battery:.2f}V", "HTTP", status, response[:180])
            if status in (400, 403, 404, 413, 422):
                print("Error no reintentable de configuración/contrato. Revisa gateway, dispositivo y métricas.", file=sys.stderr)
            elif status == 0 or status == 429 or status >= 500:
                print("Error transitorio; el próximo ciclo continuará.", file=sys.stderr)

        if MAX_CYCLES and sequence >= MAX_CYCLES:
            print("Se alcanzó HOIT_CYCLES =", MAX_CYCLES)
            return 0
        time.sleep(INTERVAL)


if __name__ == "__main__":
    raise SystemExit(main())
