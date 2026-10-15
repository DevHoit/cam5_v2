import { parseElectricalAlarmConfig } from "./electrical";

// Electrical points own their timeout; legacy points use their reading profile.
export function telemetryTimeoutSeconds(assetType: string, metadata: Record<string, unknown> | null | undefined, profileTimeout: number | null) {
  return assetType === "electrical_point"
    ? parseElectricalAlarmConfig(metadata).staleAfterSeconds
    : profileTimeout ?? 180;
}

export function telemetryIsStale(recordedAt: Date | null, timeoutSeconds: number, now: Date) {
  return !recordedAt || now.getTime() - recordedAt.getTime() > timeoutSeconds * 1000;
}

export function effectiveDeviceState(state: string, recordedAt: Date | null, timeoutSeconds: number, now: Date) {
  // Preserve commissioning and maintenance lifecycle states.
  if (!["active", "offline"].includes(state)) return state;
  return telemetryIsStale(recordedAt, timeoutSeconds, now) ? "offline" : state;
}
