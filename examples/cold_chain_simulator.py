#!/usr/bin/env python3
"""
HOIT Cold Chain schema v2 simulator.

This is not the production gateway. It is a development tool used to validate
frontend/backend behavior before the embedded gateway implementation is ready.

Environment variables:
  HOIT_BASE_URL      e.g. https://preview-url.vercel.app
  HOIT_GATEWAY_TOKEN gateway Bearer token
  HOIT_GATEWAY_CODE  e.g. GW-TEMP-01
  HOIT_DEVICES       comma-separated device codes, e.g. TEMP-01,TEMP-02,TEMP-03
  HOIT_INTERVAL      seconds between cycles (default: 5)
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
BOOT_ID = str(uuid.uuid4())


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
            "User-Agent": "hoit-cold-chain-simulator/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8")
    except urllib.error.URLError as exc:
        return 0, str(exc.reason)


def simulated_temperature(device_index: int, elapsed: float) -> float:
    base = 4.2 + device_index * 0.35
    slow_cycle = math.sin(elapsed / 120.0 + device_index) * 0.55
    noise = random.uniform(-0.12, 0.12)
    return round(base + slow_cycle + noise, 2)


def main() -> int:
    if not BASE_URL or not TOKEN:
        print("HOIT_BASE_URL y HOIT_GATEWAY_TOKEN son obligatorios.", file=sys.stderr)
        return 2
    if not DEVICES:
        print("HOIT_DEVICES debe contener al menos un sensor.", file=sys.stderr)
        return 2

    print("HOIT Cold Chain simulator")
    print("base_url =", BASE_URL)
    print("gateway  =", GATEWAY_CODE)
    print("devices  =", ", ".join(DEVICES))
    print("boot_id  =", BOOT_ID)

    started = time.monotonic()
    sequence = 0
    advertising_counts = {device: random.randint(10_000, 50_000) for device in DEVICES}

    while True:
        sequence += 1
        sampled_at = iso_now()
        elapsed = time.monotonic() - started

        for index, device in enumerate(DEVICES):
            advertising_counts[device] += random.randint(3, 8)
            payload = {
                "schemaVersion": "2.0",
                "batchKey": f"{GATEWAY_CODE}:{BOOT_ID}:{sequence}:{device}",
                "sentAt": iso_now(),
                "sampledAt": sampled_at,
                "timeQuality": "synced",
                "quality": "good",
                "gateway": {
                    "code": GATEWAY_CODE,
                    "bootId": BOOT_ID,
                    "sequence": sequence,
                },
                "device": {
                    "code": device,
                    "driver": "eddystone_tlm",
                },
                "metrics": {
                    "environment.temperature": simulated_temperature(index, elapsed),
                    "sensor.battery_voltage": round(3.58 - elapsed / 10_000_000, 3),
                    "sensor.rssi": random.randint(-76, -58),
                    "sensor.adv_count": advertising_counts[device],
                },
            }

            status, response = post(payload)
            print(sampled_at, device, "HTTP", status, response[:220])
            if status in (400, 403, 404, 413, 422):
                print("Error no reintentable de configuración/contrato. Revisa gateway, device y métricas.", file=sys.stderr)
            elif status == 0 or status == 429 or status >= 500:
                print("Error transitorio; el próximo ciclo continuará.", file=sys.stderr)

        time.sleep(INTERVAL)


if __name__ == "__main__":
    raise SystemExit(main())
