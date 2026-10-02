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


test("reportXlsx creates an electrical workbook with meter summaries", () => {
  const electrical: ReportSnapshot = {
    ...snapshot,
    template: { id: "tpl-electrical", key: "electrical-summary", name: "Informe de monitoreo eléctrico", description: null },
    asset: { id: "asset-electrical", code: "TAB-01", name: "Tablero 01", area: "Sala eléctrica", nominalVoltageKv: 0.4, assetType: "electrical_point" },
    coldChain: undefined,
    summary: {
      condition: "critical",
      channelCount: 3,
      sampleCount: 300,
      validSampleCount: 299,
      qualityPercent: 99.67,
      alarmCount: 1,
      warningCount: 0,
      criticalCount: 1,
    },
    channels: [{
      code: "PM01:P_ACTIVE",
      name: "PM5560 · Potencia activa total",
      zone: "Sala eléctrica",
      unit: "kW",
      sampleCount: 100,
      validSampleCount: 100,
      minimum: 18,
      average: 24.5,
      maximum: 31,
      latest: 25,
      latestAt: "2026-10-02T11:59:00.000Z",
    }],
    electrical: {
      meterCount: 1,
      limits: {
        staleAfterSeconds: 30,
        thresholdDelaySeconds: 5,
        voltageMinV: 210,
        voltageMaxV: 250,
        currentMaxA: 80,
        frequencyMinHz: 49,
        frequencyMaxHz: 51,
        powerFactorMin: 0.9,
      },
      meters: [{
        code: "PM01",
        name: "PM5560 principal",
        sampleCount: 300,
        validSampleCount: 299,
        qualityPercent: 99.67,
        voltageMinimumV: 225,
        voltageAverageV: 230,
        voltageMaximumV: 235,
        currentMaximumA: 76,
        activePowerAverageKw: 24.5,
        activePowerMaximumKw: 31,
        apparentPowerAverageKva: 25.8,
        reactivePowerAverageKvar: 6.2,
        powerFactorMinimum: 0.91,
        powerFactorAverage: 0.95,
        frequencyMinimumHz: 49.92,
        frequencyAverageHz: 50,
        frequencyMaximumHz: 50.08,
        energyImportStartKwh: 1000,
        energyImportEndKwh: 1040,
        energyImportDeltaKwh: 40,
        energyExportStartKwh: 0,
        energyExportEndKwh: 0,
        energyExportDeltaKwh: 0,
        peakDemandKw: 31,
      }],
    },
    alarms: [{
      code: "EL-001",
      title: "Sobrecorriente L1",
      severity: "critical",
      status: "resolved",
      openedAt: "2026-10-02T10:00:00.000Z",
      channelCode: "PM01",
      triggerValue: 85,
      thresholdValue: 80,
    }],
  };

  const bytes = reportXlsx(electrical);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /Medidores/);
  assert.match(text, /Variables/);
  assert.match(text, /PM5560 principal/);
  assert.match(text, /E imp/);
});
