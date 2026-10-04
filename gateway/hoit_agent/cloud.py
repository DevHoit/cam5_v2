from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable


@dataclass(frozen=True)
class CloudResponse:
    status: int
    body: dict[str, Any] | None
    text: str


Transport = Callable[[urllib.request.Request, int], CloudResponse]


def _default_transport(request: urllib.request.Request, timeout: int) -> CloudResponse:
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read().decode("utf-8")
            return CloudResponse(response.status, json.loads(text) if text else None, text)
    except urllib.error.HTTPError as error:
        text = error.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(text) if text else None
        except json.JSONDecodeError:
            body = None
        return CloudResponse(error.code, body, text)


class CloudClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        timeout_seconds: int = 15,
        transport: Transport | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout_seconds = timeout_seconds
        self.transport = transport or _default_transport

    def request(self, path: str, method: str = "GET", payload: dict[str, Any] | None = None) -> CloudResponse:
        data = None if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            self.base_url + path,
            data=data,
            method=method,
            headers={
                "Authorization": "Bearer " + self.token,
                "Content-Type": "application/json",
                "User-Agent": "hoit-gateway-agent/0.1.0",
            },
        )
        try:
            return self.transport(request, self.timeout_seconds)
        except (OSError, urllib.error.URLError, TimeoutError) as error:
            return CloudResponse(0, None, str(error))

    def config(self) -> CloudResponse:
        return self.request("/api/v1/gateway/config")

    def ingest(self, payload: dict[str, Any]) -> CloudResponse:
        return self.request("/api/v1/gateway/ingest", "POST", payload)

    def heartbeat(self, payload: dict[str, Any]) -> CloudResponse:
        return self.request("/api/v1/gateway/heartbeat", "POST", payload)
