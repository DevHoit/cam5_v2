#!/usr/bin/env python3
"""Emisor de referencia para el contrato CAM5 Gateway v1.1 (ingestión v1.0)."""

import json
import os
import random
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone


API_BASE = os.environ.get("CAM5_API_BASE", "https://cam5v2.vercel.app/api/v1").rstrip("/")
TOKEN = os.environ.get("CAM5_GATEWAY_TOKEN", "")
RUN_ONCE = os.environ.get("CAM5_RUN_ONCE", "").lower() in ("1", "true", "yes")
BOOT_ID = str(uuid.uuid4())
STARTED_MONOTONIC = time.monotonic()


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def request_json(path, method="GET", payload=None):
    data = None if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        API_BASE + path,
        data=data,
        method=method,
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return response.status, json.loads(response.read().decode("utf-8"))


def simulated_raw(register):
    if 418 <= register <= 429:
        return random.randint(450, 700)
    if 430 <= register <= 445:
        return random.randint(250, 380) if register % 2 == 0 else random.randint(400, 800)
    if 446 <= register <= 453:
        return random.randint(5, 95)
    if register == 454:
        return 16
    if 455 <= register <= 490:
        return random.randint(0, 120)
    if 491 <= register <= 498:
        return random.randint(0, 500)
    return random.randint(0, 100)


def send_with_retry(payload):
    for delay in (0, 2, 5, 15):
        if delay:
            time.sleep(delay)
        try:
            status, response = request_json("/gateway/ingest", "POST", payload)
            if status in (200, 202):
                print(response["status"], payload["batchKey"], "registros:", response["accepted"])
                return True
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            if 400 <= error.code < 500 and error.code != 429:
                print("Lote rechazado", error.code, detail)
                return False
            print("Error temporal HTTP", error.code, detail)
        except OSError as error:
            print("Error de red", error)
    return False


def main():
    if not TOKEN:
        raise SystemExit("Configura CAM5_GATEWAY_TOKEN antes de iniciar.")
    _, configuration = request_json("/gateway/config")
    gateway = configuration["gateway"]
    if not configuration["devices"]:
        raise SystemExit("El gateway no tiene controladores asignados.")
    device = configuration["devices"][0]
    ranges = [item for item in configuration["devices"][0]["ranges"] if item.get("enabled", True)]
    next_run = {item["name"]: 0.0 for item in ranges}
    sequence = 0

    while True:
        now = time.monotonic()
        for item in ranges:
            if now < next_run[item["name"]]:
                continue
            sequence += 1
            started_at = utc_now()
            started_clock = time.monotonic()
            registers = list(range(item["startRegister"], item["endRegister"] + 1))
            captured_at = utc_now()
            payload = {
                "schemaVersion": "1.0",
                "batchKey": BOOT_ID + ":" + str(item["startRegister"]) + "-" + str(item["endRegister"]) + ":" + str(sequence),
                "sentAt": utc_now(),
                "gateway": {
                    "code": gateway["code"],
                    "bootId": BOOT_ID,
                    "sequence": sequence,
                    "uptimeSeconds": int(time.monotonic() - STARTED_MONOTONIC),
                },
                "device": {"code": device["code"], "unitId": device["unitId"], "dataVersion": 16},
                "poll": {
                    "startedAt": started_at,
                    "completedAt": captured_at,
                    "expectedRegisters": len(registers),
                    "latencyMs": int((time.monotonic() - started_clock) * 1000),
                },
                "readings": [
                    {
                        "register": register,
                        "rawValue": simulated_raw(register),
                        "recordedAt": captured_at,
                        "sequence": sequence,
                        "quality": "good",
                        "flags": [],
                    }
                    for register in registers
                ],
            }
            send_with_retry(payload)
            next_run[item["name"]] = time.monotonic() + item["intervalMs"] / 1000.0
        if RUN_ONCE:
            return
        time.sleep(0.1)


if __name__ == "__main__":
    main()
