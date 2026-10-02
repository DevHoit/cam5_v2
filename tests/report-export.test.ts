import assert from "node:assert/strict";
import test from "node:test";
import { reportXlsx } from "../db/report-export";
import type { ReportSnapshot } from "../db/report-engine";

const snapshot: ReportSnapshot = {
  generatedAt: "2026-10-02T12:00:00.000Z",
  generatedBy: "Tester",
  template: { id: "tpl", key: "cold-chain-summary", name: "Informe de cadena de frío", description: null },
  client: { code: "CLIENT", name: "Cliente" },
  site: { code: "SITE", name: "Sitio", timezone: "America/Santiago" },
  asset: { id: "asset", code: "CR-01", name: "Cámara 01", area: "Farmacia", nominalVoltageKv: null, assetType: "cold_room" },
  period: { start: "2026-10-01T00:00:00.000Z", end: "2026-10-02T00:00:00.000Z" },
  summary: {
    condition: "warning",
    channelCount: 2,
    sampleCount: 100,
    validSampleCount: 98,
    qualityPercent: 98,
    alarmCount: 1,
    warningCount: 1,
    criticalCount: 0,
  },
  channels: [{
    code: "TEMP-01",
    name: "Sensor principal",
    zone: "Farmacia",
    unit: "°C",
    sampleCount: 50,
    validSampleCount: 49,
    minimum: 2.1,
    average: 4.3,
    maximum: 7.8,
    latest: null,
    latestAt: null,
  }],
  coldChain: {
    minimumC: 2,
    maximumC: 8,
    targetC: 5,
    excursionDelaySeconds: 300,
    staleAfterSeconds: 180,
    excursionCount: 1,
    totalOutOfRangeSeconds: 420,
    dataGapCount: 1,
    sensors: [{
      code: "TEMP-01",
      name: "Sensor principal",
      minimumC: 2.1,
      averageC: 4.3,
      maximumC: 9.2,
      sampleCount: 50,
      validSampleCount: 49,
      excursionCount: 1,
      dataGapCount: 1,
    }],
    excursions: [{
      sensorCode: "TEMP-01",
      sensorName: "Sensor principal",
      type: "high",
      startedAt: "2026-10-01T10:00:00.000Z",
      endedAt: "2026-10-01T10:07:00.000Z",
      durationSeconds: 420,
      extremeC: 9.2,
      active: false,
    }],
  },
  alarms: [{
    code: "CC-001",
    title: "Temperatura alta",
    severity: "warning",
    status: "resolved",
    openedAt: "2026-10-01T10:05:00.000Z",
    channelCode: null,
    triggerValue: 9.2,
    thresholdValue: 8,
  }],
};

test("reportXlsx creates an OOXML workbook with cold-chain sheets", () => {
  const bytes = reportXlsx(snapshot);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /xl\/workbook\.xml/);
  assert.match(text, /Resumen/);
  assert.match(text, /Sensores/);
  assert.match(text, /Excursiones/);
  assert.match(text, /Alarmas/);
  assert.match(text, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet\.main\+xml/);
});
