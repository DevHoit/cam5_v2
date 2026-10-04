from __future__ import annotations

import json
import sys

from .runtime import GatewayRuntime, RuntimeSettings


def main() -> int:
    runtime = GatewayRuntime(RuntimeSettings.from_environment())
    try:
        result = runtime.run_control_plane_once()
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0 if 200 <= result["heartbeat_status"] < 300 else 1
    finally:
        runtime.close()


if __name__ == "__main__":
    raise SystemExit(main())
