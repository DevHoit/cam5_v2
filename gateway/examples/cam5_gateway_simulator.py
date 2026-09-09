#!/usr/bin/env python3
"""Emisor de referencia HoitLive Core: lectura local rápida y envío desacoplado."""

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


def send_with_retry(path, payload):
    for delay in (0, 2, 5, 15):
        if delay:
            time.sleep(delay)
        try:
            status, response = request_json(path, "POST", payload)
            if status in (200, 202):
                return response
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            if 400 <= error.code < 500 and error.code != 429:
                print("Lote rechazado", error.code, detail)
                return False
            print("Error temporal HTTP", error.code, detail)
        except OSError as error:
            print("Error de red", error)
    return None


def poll_range(item, cache):
    captured_at = utc_now()
    for register in range(item["startRegister"], item["endRegister"] + 1):
        cache[register] = {"rawValue": simulated_raw(register), "recordedAt": captured_at}


def alarm_states(device, cache, definitions):
    states = {}
    for channel in device.get("channels", []):
        if not channel.get("enabled", True) or channel["register"] not in cache:
            continue
        definition = definitions[channel["register"]]
        value = cache[channel["register"]]["rawValue"] * float(definition["scaleFactor"])
        warning = channel.get("warningThreshold")
        critical = channel.get("criticalThreshold")
        states[channel["register"]] = "critical" if critical is not None and value >= critical else "warning" if warning is not None and value >= warning else "normal"
    return states


def ingestion_payload(gateway, device, cache, registers, sequence, reason):
    started_at = utc_now()
    selected = [register for register in sorted(set(registers)) if register in cache]
    completed_at = utc_now()
    return {
        "schemaVersion": "1.0",
        "batchKey": f"{BOOT_ID}:{reason}:{sequence}",
        "sentAt": utc_now(),
        "gateway": {
            "code": gateway["code"],
            "bootId": BOOT_ID,
            "sequence": sequence,
            "uptimeSeconds": int(time.monotonic() - STARTED_MONOTONIC),
        },
        "device": {"code": device["code"], "unitId": device["unitId"], "dataVersion": 16},
        "poll": {"startedAt": started_at, "completedAt": completed_at, "expectedRegisters": len(selected), "latencyMs": 0},
        "readings": [
            {
                "register": register,
                "rawValue": cache[register]["rawValue"],
                "recordedAt": cache[register]["recordedAt"],
                "sequence": sequence,
                "quality": "good",
                "flags": [],
            }
            for register in selected
        ],
    }


def main():
    if not TOKEN:
        raise SystemExit("Configura CAM5_GATEWAY_TOKEN antes de iniciar.")
    _, configuration = request_json("/gateway/config")
    gateway = configuration["gateway"]
    if not configuration["devices"]:
        raise SystemExit("El gateway no tiene controladores asignados.")
    device = configuration["devices"][0]
    ranges = [item for item in device["ranges"] if item.get("enabled", True)]
    policy = device.get("uploadPolicy") or {}
    storage_seconds = policy.get("normalIntervalMs", 60_000) / 1000.0
    heartbeat_seconds = policy.get("heartbeatIntervalMs", 30_000) / 1000.0
    diagnostic_seconds = policy.get("diagnosticIntervalMs", 300_000) / 1000.0
    definitions = {item["register"]: item for item in device["registers"]}
    operational_registers = [item["register"] for item in device.get("channels", []) if item.get("enabled", True)]
    diagnostic_registers = list(definitions)
    cache = {}
    next_poll = {item["name"]: 0.0 for item in ranges}
    next_storage = 0.0
    next_heartbeat = 0.0
    next_diagnostic = time.monotonic() + diagnostic_seconds
    previous_alarm_states = {}
    last_state_upload = 0.0
    sequence = 0

    while True:
        now = time.monotonic()
        for item in ranges:
            if now >= next_poll[item["name"]]:
                poll_range(item, cache)
                next_poll[item["name"]] = now + item["intervalMs"] / 1000.0

        current_alarm_states = alarm_states(device, cache, definitions)
        alarm_changed = bool(previous_alarm_states) and current_alarm_states != previous_alarm_states and now - last_state_upload >= 30
        previous_alarm_states = current_alarm_states

        reason = None
        registers = operational_registers
        if alarm_changed:
            reason = "alarm" if any(state != "normal" for state in current_alarm_states.values()) else "recovery"
        elif now >= next_diagnostic:
            reason = "diagnostic"
            registers = diagnostic_registers
            next_diagnostic = now + diagnostic_seconds
        elif now >= next_storage:
            reason = "scheduled"

        if reason and registers:
            sequence += 1
            response = send_with_retry("/gateway/ingest", ingestion_payload(gateway, device, cache, registers, sequence, reason))
            if response:
                print(response["status"], reason, "registros:", response["accepted"])
                next_storage = now + response.get("nextUploadInMs", storage_seconds * 1000) / 1000.0
                if reason in ("alarm", "recovery"):
                    last_state_upload = now

        if now >= next_heartbeat:
            heartbeat = send_with_retry("/gateway/heartbeat", {})
            if heartbeat:
                next_heartbeat = now + heartbeat.get("nextHeartbeatInMs", heartbeat_seconds * 1000) / 1000.0
        if RUN_ONCE:
            return
        time.sleep(0.1)


if __name__ == "__main__":
    main()
