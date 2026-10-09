#!/usr/bin/env python3
"""Run the scoped Preview evaluation periodically; never call Production."""
import argparse
import http.cookiejar
import json
import os
import sys
import time
import urllib.parse
import urllib.request

DEFAULT_URL = "https://cam5v2-git-feature-hoit-core-v1-hoit1.vercel.app"


class SameOriginRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        if urllib.parse.urlsplit(new_url).netloc != urllib.parse.urlsplit(request.full_url).netloc:
            raise ValueError("El endpoint no debe redirigir la credencial a otro origen.")
        return super().redirect_request(request, fp, code, message, headers, new_url)


def request_json(opener, url, token=None):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(url, headers=headers, method="POST" if token else "GET")
    with opener.open(request, timeout=90) as response:
        if "application/json" not in response.headers.get("Content-Type", ""):
            raise ValueError("Se esperaba JSON; comprueba el acceso a Deployment Protection.")
        return json.load(response)


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--interval", type=int, default=60)
    parser.add_argument("--cycles", type=int, default=3, help="0 = continuo; por defecto 3 ciclos")
    args = parser.parse_args()
    if args.interval < 60 or args.cycles < 0:
        raise ValueError("Intervalo mínimo 60 segundos; cycles debe ser >= 0.")
    base = os.environ.get("HOIT_PREVIEW_URL", DEFAULT_URL).rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    if base != DEFAULT_URL or parsed.scheme != "https" or not parsed.hostname or not parsed.hostname.endswith(".vercel.app") or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password or parsed.port:
        raise ValueError("Utiliza exclusivamente el Preview de feature/hoit-core-v1.")
    token = os.environ.get("HOIT_PREVIEW_OPERATIONS_TOKEN")
    if not token:
        raise ValueError("Falta HOIT_PREVIEW_OPERATIONS_TOKEN.")
    jar = http.cookiejar.CookieJar()
    access_url = os.environ.get("HOIT_PREVIEW_ACCESS_URL")
    if access_url:
        access = urllib.parse.urlsplit(access_url)
        if access.scheme != "https" or access.netloc != parsed.netloc:
            raise ValueError("El acceso temporal debe pertenecer al mismo Preview.")
        access_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        with access_opener.open(access_url, timeout=30) as response:
            response.read()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), SameOriginRedirect())
    completed = 0
    while args.cycles == 0 or completed < args.cycles:
        cycle_start = time.monotonic()
        health = request_json(opener, base + "/api/v1/health")
        if health.get("deployment", {}).get("environment") != "preview" or health.get("database") != "ok":
            raise ValueError("El destino no acredita Preview con base sana; no se ejecutó el ciclo.")
        result = request_json(opener, base + "/api/v1/system/operations", token)
        if not result.get("ok") or result.get("mode") != "evaluate_only" or result.get("dispatchSkipped") is not True or result.get("sites") != 1 or not result.get("siteId") or result.get("notifications", {}).get("processed") != 0 or result.get("escalations", {}).get("processed") != 0:
            raise ValueError("El ciclo no acredita evaluación aislada sin despacho; se detiene el worker.")
        completed += 1
        print(json.dumps({
            "cycle": completed, "revision": health["deployment"].get("revision"),
            "mode": result["mode"], "siteId": result["siteId"], "sites": result["sites"],
            "startedAt": result["startedAt"], "completedAt": result["completedAt"],
            "evaluations": result["evaluations"], "evaluationFailures": result["evaluationFailures"],
            "dispatchSkipped": result["dispatchSkipped"], "ok": result["ok"],
        }), flush=True)
        if args.cycles == 0 or completed < args.cycles:
            time.sleep(max(0, args.interval - (time.monotonic() - cycle_start)))


if __name__ == "__main__":
    try:
        run()
    except Exception as error:
        # Avoid exception URLs, headers and server bodies, which may contain credentials.
        print("Worker detenido: " + type(error).__name__ + ". Revisa configuración, acceso y respuesta del ciclo.", file=sys.stderr)
        sys.exit(1)
