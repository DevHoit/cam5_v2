#!/usr/bin/env python3
"""
Unified HOIT Gateway simulator.

It generates realistic device metrics but sends them using the exact
Gateway Agent -> HOIT Core V1 envelope:
  GET  /api/v1/gateway/config
  POST /api/v1/gateway/ingest
  POST /api/v1/gateway/heartbeat

The simulator never writes directly to the database and never sends protocol,
register, driver or physical bus details inside telemetry samples.

Keep HOIT_GATEWAY_TOKEN in an environment variable so it is not stored in
shell history.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Any


ROOT = Path(__file__).resolve().parent
BOOT_ID = str(uuid.uuid4())
SOFTWARE_VERSION = "hoit-simulator/1.0"

PROFILES = {
    "cam5": {
        "script": "cam5_simulator.py", "gateway": "GW-CAM5-E2E", "devices": "CAM5-E2E-01",
        "scenarios": "normal|high_temperature|brief|high_humidity|partial_discharge|surface_discharge",
    },
    "pm5560": {
        "script": "pm5560_simulator.py",
        "gateway": "GW-PM01",
        "devices": "PM5560-01",
        "scenarios": "normal|undervoltage|overvoltage|overcurrent|low_pf|demo",
    },
    "dse8660": {
        "script": "dse8660_simulator.py",
        "gateway": "GW-DSE",
        "devices": "DSE8660-01,DSE8660-02",
        "scenarios": "normal|source1_fail|source2_fail|transfer_to_source2|common_alarm|demo",
    },
    "cold-chain": {
        "script": "cold_chain_simulator.py",
        "gateway": "GW-TEMP-01",
        "devices": "TEMP-01,TEMP-02",
        "scenarios": "normal|high|low|battery|disagreement|demo",
    },
}

PRODUCTION_HOSTS = {
    "core.hoitlive.com",
    "cam5v2.vercel.app",
    "hoitlive.com",
    "www.hoitlive.com",
}


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def cli() -> argparse.Namespace:
    command = argparse.ArgumentParser(
        description="Emula un HOIT Gateway Agent y publica telemetría de dispositivos al Core.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    command.add_argument("--profile", required=True, choices=sorted(PROFILES), help="Tipo de dispositivo que generará las métricas.")
    command.add_argument("--base-url", default=os.environ.get("HOIT_BASE_URL", ""), help="URL del portal/Preview.")
    command.add_argument("--gateway-code", default="", help="Código del gateway provisionado en Core.")
    command.add_argument("--devices", default="", help="Código o lista separada por comas de dispositivos existentes en Core.")
    command.add_argument("--scenario", default=os.environ.get("HOIT_SCENARIO", "normal"), help="Escenario del perfil.")
    command.add_argument("--interval", type=float, default=float(os.environ.get("HOIT_INTERVAL", "5")), help="Segundos entre lotes de telemetría.")
    command.add_argument("--cycles", type=int, default=int(os.environ.get("HOIT_CYCLES", "0")), help="0 = ejecución continua.")
    command.add_argument("--heartbeat-interval", type=float, default=30.0, help="Segundos entre heartbeats.")
    command.add_argument("--phase-seconds", type=float, default=float(os.environ.get("HOIT_PHASE_SECONDS", "25")), help="Duración de fase demo para DSE8660.")
    command.add_argument("--min-c", type=float, default=float(os.environ.get("HOIT_MIN_C", "2")), help="Límite inferior para cadena de frío.")
    command.add_argument("--max-c", type=float, default=float(os.environ.get("HOIT_MAX_C", "8")), help="Límite superior para cadena de frío.")
    command.add_argument("--target-c", type=float, default=float(os.environ.get("HOIT_TARGET_C", "5")), help="Temperatura nominal para cadena de frío.")
    command.add_argument("--alarm-delay", type=float, default=float(os.environ.get("HOIT_ALARM_DELAY", "300")), help="Persistencia esperada de excursión.")
    command.add_argument("--warmup-seconds", type=float, default=float(os.environ.get("HOIT_WARMUP_SECONDS", "15")), help="Fase normal inicial del demo frío.")
    command.add_argument("--recovery-seconds", type=float, default=float(os.environ.get("HOIT_RECOVERY_SECONDS", "30")), help="Fase de recuperación del demo frío.")
    command.add_argument("--allow-production", action="store_true", help="Permite apuntar deliberadamente a un host productivo conocido.")
    return command.parse_args()


def request_json(base_url: str, token: str, path: str, method: str = "GET", payload: dict[str, Any] | None = None) -> tuple[int, dict[str, Any] | None, str]:
    data = None if payload is None else json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        base_url.rstrip("/") + path,
        data=data,
        method=method,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "User-Agent": SOFTWARE_VERSION,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            text = response.read().decode("utf-8")
            return response.status, json.loads(text) if text else None, text
    except urllib.error.HTTPError as error:
        text = error.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(text) if text else None
        except json.JSONDecodeError:
            body = None
        return error.code, body, text
    except (OSError, urllib.error.URLError, TimeoutError) as error:
        return 0, None, str(error)


def load_profile_module(profile: str, args: argparse.Namespace, devices: list[str]) -> ModuleType:
    os.environ["HOIT_SCENARIO"] = args.scenario
    os.environ["HOIT_DEVICES"] = ",".join(devices)
    os.environ["HOIT_DEVICE_CODE"] = devices[0]
    os.environ["HOIT_INTERVAL"] = str(args.interval)
    os.environ["HOIT_PHASE_SECONDS"] = str(args.phase_seconds)
    os.environ["HOIT_MIN_C"] = str(args.min_c)
    os.environ["HOIT_MAX_C"] = str(args.max_c)
    os.environ["HOIT_TARGET_C"] = str(args.target_c)
    os.environ["HOIT_ALARM_DELAY"] = str(args.alarm_delay)
    os.environ["HOIT_WARMUP_SECONDS"] = str(args.warmup_seconds)
    os.environ["HOIT_RECOVERY_SECONDS"] = str(args.recovery_seconds)

    script = ROOT / PROFILES[profile]["script"]
    spec = importlib.util.spec_from_file_location("hoit_sim_profile", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"No fue posible cargar {script.name}.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_metrics(
    profile: str,
    module: ModuleType,
    devices: list[str],
    elapsed: float,
    state: dict[str, Any],
) -> tuple[str, list[dict[str, Any]], bool]:
    sampled_at = iso_now()

    if profile == "cam5":
        phase = module.phase(elapsed)
        return phase, [{"device_id": device, "sampled_at": sampled_at, "quality": "GOOD", "metrics": module.metrics(elapsed, phase)} for device in devices], False

    if profile == "pm5560":
        phase = module.phase(elapsed)
        values, energy = module.metrics(elapsed, phase, float(state.get("energy_import", 12540.0)))
        state["energy_import"] = energy
        return phase, [{
            "device_id": devices[0],
            "sampled_at": sampled_at,
            "quality": "GOOD",
            "metrics": values,
        }], False

    if profile == "dse8660":
        phase = module.phase(elapsed)
        samples = [{
            "device_id": device,
            "sampled_at": sampled_at,
            "quality": "GOOD",
            "metrics": module.metrics(index, elapsed, phase),
        } for index, device in enumerate(devices)]
        return phase, samples, False

    phase = module.scenario_phase(elapsed)
    if phase == "done":
        return phase, [], True

    advertising_counts = state.setdefault(
        "advertising_counts",
        {device: random.randint(10_000, 50_000) for device in devices},
    )
    samples = []
    for index, device in enumerate(devices):
        advertising_counts[device] = int(advertising_counts.get(device, 10_000)) + random.randint(3, 8)
        samples.append({
            "device_id": device,
            "sampled_at": sampled_at,
            "quality": "GOOD",
            "metrics": {
                "environment.temperature": module.simulated_temperature(index, elapsed, phase),
                "sensor.battery_voltage": module.simulated_battery(phase, elapsed),
                "sensor.rssi": random.randint(-76, -58),
                "sensor.adv_count": advertising_counts[device],
            },
        })
    return phase, samples, False


def validate_remote_configuration(
    base_url: str,
    token: str,
    gateway_code: str,
    devices: list[str],
) -> dict[str, Any]:
    status, body, text = request_json(base_url, token, "/api/v1/gateway/config")
    if status != 200 or not isinstance(body, dict):
        raise RuntimeError(f"GET /gateway/config falló (HTTP {status}): {text[:300]}")
    if body.get("schema_version") != "1.0":
        raise RuntimeError("Core devolvió una versión de configuración no compatible con Gateway Agent V1.")
    remote_gateway = str(body.get("gateway_id") or "").upper()
    if remote_gateway != gateway_code:
        raise RuntimeError(f"La credencial corresponde a {remote_gateway or 'otro gateway'}, no a {gateway_code}.")

    remote_devices = {
        str(item.get("device_id") or "").upper()
        for item in body.get("devices", [])
        if isinstance(item, dict) and item.get("enabled", True)
    }
    missing = [device for device in devices if device not in remote_devices]
    if missing:
        raise RuntimeError("Dispositivos no habilitados para este gateway: " + ", ".join(missing))
    return body


def heartbeat_payload(gateway_code: str, devices: list[str], started: float, last_success_at: str | None) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "gateway_id": gateway_code,
        "boot_id": BOOT_ID,
        "software_version": SOFTWARE_VERSION,
        "uptime_seconds": max(0, int(time.monotonic() - started)),
        "buffer": {
            "pending_messages": 0,
            "bytes": 0,
            "usage_percent": 0.0,
        },
        "network": {
            "active_interface": "simulator",
            "rssi_dbm": None,
            "ip_available": True,
        },
        "system": {
            "cpu_percent": 8.0,
            "memory_percent": 18.0,
            "disk_percent": 12.0,
        },
        "interfaces": {
            "simulator": "ONLINE",
        },
        "devices": [{
            "device_id": device,
            "status": "ONLINE",
            "latency_ms": 5.0,
            "last_success_at": last_success_at,
            "consecutive_errors": 0,
        } for device in devices],
    }


def main() -> int:
    args = cli()
    profile = PROFILES[args.profile]
    token = os.environ.get("HOIT_GATEWAY_TOKEN", "")
    base_url = args.base_url.strip().rstrip("/")
    gateway_code = (args.gateway_code or profile["gateway"]).strip().upper()
    devices = [item.strip().upper() for item in (args.devices or profile["devices"]).split(",") if item.strip()]
    scenario = args.scenario.strip().lower()

    if not token:
        print("HOIT_GATEWAY_TOKEN es obligatorio. Expórtalo como variable de entorno.", file=sys.stderr)
        return 2
    if not base_url:
        print("--base-url o HOIT_BASE_URL es obligatorio.", file=sys.stderr)
        return 2
    host = (urllib.parse.urlparse(base_url).hostname or "").lower()
    if args.profile == "cam5" and (base_url != "https://cam5v2-git-feature-hoit-core-v1-hoit1.vercel.app" or gateway_code != "GW-CAM5-E2E" or devices != ["CAM5-E2E-01"]):
        print("El perfil CAM5 de laboratorio sólo admite el Preview de feature/hoit-core-v1, GW-CAM5-E2E y CAM5-E2E-01.", file=sys.stderr)
        return 2
    if host in PRODUCTION_HOSTS and not args.allow_production:
        print(f"El simulador se negó a enviar datos al host productivo {host}. Usa un Preview o agrega --allow-production de forma deliberada.", file=sys.stderr)
        return 2
    if args.interval < 1 or args.heartbeat_interval < 5:
        print("--interval debe ser >= 1 y --heartbeat-interval >= 5.", file=sys.stderr)
        return 2
    if args.cycles < 0:
        print("--cycles no puede ser negativo.", file=sys.stderr)
        return 2
    if not gateway_code or not devices:
        print("Gateway y dispositivos deben tener código.", file=sys.stderr)
        return 2
    if args.profile == "pm5560" and len(devices) != 1:
        print("El perfil PM5560 admite un dispositivo por proceso. Ejecuta otra instancia para otro gateway/medidor.", file=sys.stderr)
        return 2
    allowed = set(profile["scenarios"].split("|"))
    if scenario not in allowed:
        print(f"Escenario no válido para {args.profile}: {scenario}. Opciones: {profile['scenarios']}", file=sys.stderr)
        return 2
    if args.profile == "cold-chain" and args.min_c >= args.max_c:
        print("--min-c debe ser menor que --max-c.", file=sys.stderr)
        return 2

    try:
        remote = validate_remote_configuration(base_url, token, gateway_code, devices)
        module = load_profile_module(args.profile, args, devices)
    except (RuntimeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 2

    upload = remote.get("upload") if isinstance(remote.get("upload"), dict) else {}
    remote_interval = upload.get("interval_seconds")
    print("HOIT Gateway simulator")
    print("contract =", "schema_version 1.0 / samples[]")
    print("profile  =", args.profile)
    print("gateway  =", gateway_code)
    print("devices  =", ", ".join(devices))
    print("scenario =", scenario)
    print("endpoint =", base_url + "/api/v1/gateway/ingest")
    if isinstance(remote_interval, int):
        print("core cfg =", f"upload_interval_seconds={remote_interval}")
    print("boot_id  =", BOOT_ID)

    started = time.monotonic()
    sequence = 0
    cycles = 0
    state: dict[str, Any] = {}
    next_heartbeat = 0.0
    last_success_at: str | None = None
    last_phase = ""

    while True:
        elapsed = time.monotonic() - started
        phase, samples, done = build_metrics(args.profile, module, devices, elapsed, state)
        if done:
            print("Demo completada.")
            return 0
        if phase != last_phase:
            print("phase    =", phase)
            last_phase = phase

        sequence += 1
        cycles += 1
        message_id = str(uuid.uuid4())
        payload = {
            "schema_version": "1.0",
            "gateway_id": gateway_code,
            "boot_id": BOOT_ID,
            "message_id": message_id,
            "sequence": sequence,
            "created_at": iso_now(),
            "time_quality": "SYNCED",
            "samples": samples,
        }
        status, body, text = request_json(base_url, token, "/api/v1/gateway/ingest", "POST", payload)
        if 200 <= status < 300:
            last_success_at = samples[0]["sampled_at"] if samples else iso_now()
            accepted = body.get("accepted") if isinstance(body, dict) else None
            echoed = body.get("message_id") if isinstance(body, dict) else None
            print(last_success_at, phase, f"samples={len(samples)}", f"HTTP={status}", f"accepted={accepted}", f"message={echoed or message_id}")
        else:
            print(f"Ingest HTTP {status}: {text[:300]}", file=sys.stderr)
            if 400 <= status < 500 and status != 429:
                print("Error contractual/configuración: se detiene para no generar ruido ni reintentos inválidos.", file=sys.stderr)
                return 1

        now = time.monotonic()
        if now >= next_heartbeat:
            hb = heartbeat_payload(gateway_code, devices, started, last_success_at)
            hb_status, hb_body, hb_text = request_json(base_url, token, "/api/v1/gateway/heartbeat", "POST", hb)
            if 200 <= hb_status < 300:
                next_seconds = hb_body.get("next_heartbeat_seconds") if isinstance(hb_body, dict) else None
                interval = float(next_seconds) if isinstance(next_seconds, int) and next_seconds >= 5 else args.heartbeat_interval
                next_heartbeat = now + interval
                print("heartbeat=", hb_status, f"next={interval:g}s")
            else:
                print(f"Heartbeat HTTP {hb_status}: {hb_text[:240]}", file=sys.stderr)
                next_heartbeat = now + args.heartbeat_interval

        if args.cycles and cycles >= args.cycles:
            print("Ciclos completados =", cycles)
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
