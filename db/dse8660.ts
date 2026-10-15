export const DSE8660_CORE_METRIC_KEYS = [
  "ats.source1.voltage.l1_n",
  "ats.source1.voltage.l2_n",
  "ats.source1.voltage.l3_n",
  "ats.source1.voltage.l1_l2",
  "ats.source1.voltage.l2_l3",
  "ats.source1.voltage.l3_l1",
  "ats.source1.frequency",
  "ats.source2.voltage.l1_n",
  "ats.source2.voltage.l2_n",
  "ats.source2.voltage.l3_n",
  "ats.source2.voltage.l1_l2",
  "ats.source2.voltage.l2_l3",
  "ats.source2.voltage.l3_l1",
  "ats.source2.frequency",
  "ats.load.current.l1",
  "ats.load.current.l2",
  "ats.load.current.l3",
  "ats.load.power.active.total",
  "ats.load.power.reactive.total",
  "ats.load.power.apparent.total",
  "ats.load.power_factor",
  "ats.source1.available",
  "ats.source2.available",
  "ats.breaker.source1_closed",
  "ats.breaker.source2_closed",
  "ats.transfer.position",
  "ats.common_alarm",
  "ats.active_alarm_count",
  "dse.mode",
] as const;

export const DSE8660_CAPABILITIES = [
  "source1_voltage",
  "source1_frequency",
  "source2_voltage",
  "source2_frequency",
  "load_current",
  "load_power",
  "transfer_position",
  "breaker_state",
  "source_availability",
  "common_alarm",
  "operating_mode",
] as const;

export const DSE8660_DEFAULT_ACQUISITION = {
  dataBits: 8,
  stopBits: 1,
  pollIntervalMs: 1000,
  readOnly: true,
} as const;

export function dse8660MetricCode(key: string) {
  return key.replaceAll(".", "-").replaceAll("_", "-").toUpperCase();
}
