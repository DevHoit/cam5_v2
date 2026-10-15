export const PM5560_CORE_METRIC_KEYS = [
  "electrical.voltage.l1_n",
  "electrical.voltage.l2_n",
  "electrical.voltage.l3_n",
  "electrical.voltage.l1_l2",
  "electrical.voltage.l2_l3",
  "electrical.voltage.l3_l1",
  "electrical.current.l1",
  "electrical.current.l2",
  "electrical.current.l3",
  "electrical.power.active.total",
  "electrical.power.reactive.total",
  "electrical.power.apparent.total",
  "electrical.power_factor",
  "electrical.frequency",
  "electrical.energy.import",
  "electrical.energy.export",
  "electrical.demand.active",
] as const;

export const PM5560_CAPABILITIES = [
  "voltage",
  "current",
  "active_power",
  "reactive_power",
  "apparent_power",
  "power_factor",
  "frequency",
  "energy",
  "demand",
] as const;

export const PM5560_DEFAULT_RS485 = {
  baudRate: 19200,
  parity: "even",
  dataBits: 8,
  stopBits: 1,
  pollIntervalMs: 1000,
} as const;

export function pm5560MetricCode(key: string) {
  return key.replace(/^electrical\./, "").replaceAll(".", "-").replaceAll("_", "-").toUpperCase();
}
