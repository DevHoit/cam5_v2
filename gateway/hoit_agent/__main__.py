from __future__ import annotations

import json
import os
import signal
import sys

from .runtime import GatewayRuntime, RuntimeSettings


def main() -> int:
    runtime = GatewayRuntime(RuntimeSettings.from_environment())
    run_once = os.environ.get("HOIT_RUN_ONCE", "").lower() in {"1", "true", "yes"}
    stopped = False

    def request_stop(_signum, _frame):
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    try:
        if run_once:
            result = runtime.run_control_plane_once()
            print(json.dumps(result, ensure_ascii=False, sort_keys=True))
            return 0 if 200 <= result["heartbeat_status"] < 300 else 1
        runtime.run_forever(lambda: stopped)
        return 0
    finally:
        runtime.close()


if __name__ == "__main__":
    raise SystemExit(main())
