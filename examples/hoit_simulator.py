#!/usr/bin/env python3
"""
Unified HOIT device simulator launcher.

This entry point runs the existing normalized telemetry simulators using the
same Gateway -> Core schema v2 contract used by the HOIT Gateway Agent.

The gateway token is intentionally read only from HOIT_GATEWAY_TOKEN so it
does not end up in shell history.

Examples:
  export HOIT_GATEWAY_TOKEN="<token>"
  python3 examples/hoit_simulator.py --profile pm5560 \
    --base-url https://<preview>.vercel.app \
    --gateway-code GW-PM01 \
    --devices PM5560-01 \
    --scenario demo

  python3 examples/hoit_simulator.py --profile dse8660 \
    --base-url https://<preview>.vercel.app \
    --gateway-code GW-DSE \
    --devices DSE8660-01,DSE8660-02 \
    --scenario demo

  python3 examples/hoit_simulator.py --profile cold-chain \
    --base-url https://<preview>.vercel.app \
    --gateway-code GW-TEMP-01 \
    --devices TEMP-01,TEMP-02 \
    --scenario demo
"""

from __future__ import annotations

import argparse
import os
import runpy
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent

PROFILES = {
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


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(
        description="Simula dispositivos HOIT enviando telemetría normalizada al endpoint real del gateway.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    command.add_argument("--profile", required=True, choices=sorted(PROFILES), help="Tipo de dispositivo a simular.")
    command.add_argument("--base-url", default=os.environ.get("HOIT_BASE_URL", ""), help="URL del portal/Preview.")
    command.add_argument("--gateway-code", default="", help="Código del gateway provisionado en Core.")
    command.add_argument("--devices", default="", help="Código o lista separada por comas de dispositivos ya creados en Core.")
    command.add_argument("--scenario", default=os.environ.get("HOIT_SCENARIO", "normal"), help="Escenario del perfil.")
    command.add_argument("--interval", type=float, default=float(os.environ.get("HOIT_INTERVAL", "5")), help="Segundos entre ciclos.")
    command.add_argument("--cycles", type=int, default=int(os.environ.get("HOIT_CYCLES", "0")), help="0 = ejecución continua.")
    command.add_argument("--phase-seconds", type=float, default=float(os.environ.get("HOIT_PHASE_SECONDS", "25")), help="Duración de fase demo para DSE8660.")
    command.add_argument("--min-c", type=float, default=float(os.environ.get("HOIT_MIN_C", "2")), help="Límite inferior para cadena de frío.")
    command.add_argument("--max-c", type=float, default=float(os.environ.get("HOIT_MAX_C", "8")), help="Límite superior para cadena de frío.")
    command.add_argument("--target-c", type=float, default=float(os.environ.get("HOIT_TARGET_C", "5")), help="Temperatura nominal para cadena de frío.")
    command.add_argument("--alarm-delay", type=float, default=float(os.environ.get("HOIT_ALARM_DELAY", "300")), help="Persistencia esperada de excursión.")
    command.add_argument("--warmup-seconds", type=float, default=float(os.environ.get("HOIT_WARMUP_SECONDS", "15")), help="Fase normal inicial del demo frío.")
    command.add_argument("--recovery-seconds", type=float, default=float(os.environ.get("HOIT_RECOVERY_SECONDS", "30")), help="Fase de recuperación del demo frío.")
    return command


def main() -> int:
    args = parser().parse_args()
    profile = PROFILES[args.profile]

    token = os.environ.get("HOIT_GATEWAY_TOKEN", "")
    if not token:
        print("HOIT_GATEWAY_TOKEN es obligatorio. Expórtalo como variable de entorno; no lo pases por línea de comandos.", file=sys.stderr)
        return 2
    if not args.base_url.strip():
        print("--base-url o HOIT_BASE_URL es obligatorio.", file=sys.stderr)
        return 2
    if args.interval < 1:
        print("--interval debe ser al menos 1 segundo.", file=sys.stderr)
        return 2
    if args.cycles < 0:
        print("--cycles no puede ser negativo.", file=sys.stderr)
        return 2

    gateway_code = (args.gateway_code or profile["gateway"]).strip().upper()
    devices = (args.devices or profile["devices"]).strip().upper()
    if not gateway_code or not devices:
        print("Gateway y dispositivos deben tener código.", file=sys.stderr)
        return 2

    scenario = args.scenario.strip().lower()
    allowed = set(profile["scenarios"].split("|"))
    if scenario not in allowed:
        print(f"Escenario no válido para {args.profile}: {scenario}. Opciones: {profile['scenarios']}", file=sys.stderr)
        return 2

    os.environ["HOIT_BASE_URL"] = args.base_url.rstrip("/")
    os.environ["HOIT_GATEWAY_CODE"] = gateway_code
    os.environ["HOIT_SCENARIO"] = scenario
    os.environ["HOIT_INTERVAL"] = str(args.interval)
    os.environ["HOIT_CYCLES"] = str(args.cycles)

    if args.profile == "pm5560":
        first_device = next((item.strip() for item in devices.split(",") if item.strip()), "")
        if not first_device:
            print("PM5560 requiere un código de dispositivo.", file=sys.stderr)
            return 2
        os.environ["HOIT_DEVICE_CODE"] = first_device
    else:
        os.environ["HOIT_DEVICES"] = devices

    if args.profile == "dse8660":
        os.environ["HOIT_PHASE_SECONDS"] = str(args.phase_seconds)

    if args.profile == "cold-chain":
        if args.min_c >= args.max_c:
            print("--min-c debe ser menor que --max-c.", file=sys.stderr)
            return 2
        os.environ["HOIT_MIN_C"] = str(args.min_c)
        os.environ["HOIT_MAX_C"] = str(args.max_c)
        os.environ["HOIT_TARGET_C"] = str(args.target_c)
        os.environ["HOIT_ALARM_DELAY"] = str(args.alarm_delay)
        os.environ["HOIT_WARMUP_SECONDS"] = str(args.warmup_seconds)
        os.environ["HOIT_RECOVERY_SECONDS"] = str(args.recovery_seconds)

    print("HOIT unified simulator")
    print("profile  =", args.profile)
    print("contract = Gateway -> /api/v1/gateway/ingest -> schemaVersion 2.0")
    print("gateway  =", gateway_code)
    print("devices  =", devices)
    print("scenario =", scenario)
    print("endpoint =", os.environ["HOIT_BASE_URL"] + "/api/v1/gateway/ingest")
    print("")

    runpy.run_path(str(ROOT / profile["script"]), run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
