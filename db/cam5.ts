import { cam5OperationalChannels } from "../app/cam5-model";

// Semantic cloud keys. Register addresses/scaling remain in the gateway driver.
export const CAM5_METRICS = cam5OperationalChannels.map((channel) => ({
  key: `cam5.${channel.metric}.${channel.id.toLowerCase()}`,
  code: channel.id,
  name: channel.label,
  category: `cam5.${channel.metric}`,
  unit: channel.unit,
  dataType: "float",
  aggregation: "avg",
}));
export const CAM5_LAB = {
  deviceCode: "CAM5-E2E-01", assetCode: "E2E-CAM5-01", gatewayCode: "GW-CAM5-E2E",
  metricKey: "cam5.temperature.t01", threshold: 75,
} as const;
