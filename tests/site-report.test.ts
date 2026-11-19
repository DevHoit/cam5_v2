import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSiteReport, phaseOf, previousPeriod, type ReportBucket, type ReportChannel } from "../db/site-report";

const HOUR = 3_600_000;
const start = new Date("2026-11-01T03:00:00Z");
const end = new Date("2026-12-01T03:00:00Z");
const now = new Date("2026-12-01T11:00:00Z");

test("recognizes the phase of a channel by its name", () => {
  assert.deepEqual(phaseOf("Barra fase L2"), { group: "Barra", phase: "L2" });
  assert.deepEqual(phaseOf("Contacto L3"), { group: "Contacto", phase: "L3" });
  assert.equal(phaseOf("Ambiente de cabina"), null);
});

test("previous weekly and monthly periods follow the site's local calendar", () => {
  const monday = new Date("2026-11-23T11:00:00Z"); // lunes 08:00 en Santiago (UTC-3)
  const week = previousPeriod("weekly", monday, "America/Santiago");
  assert.equal(week.start.toISOString(), "2026-11-16T03:00:00.000Z");
  assert.equal(week.end.toISOString(), "2026-11-23T03:00:00.000Z");
  const month = previousPeriod("monthly", new Date("2026-12-01T11:00:00Z"), "America/Santiago");
  assert.equal(month.start.toISOString(), "2026-11-01T03:00:00.000Z");
  assert.equal(month.end.toISOString(), "2026-12-01T03:00:00.000Z");
});

test("a phase drifting away from the others asks for action; humid discharges and gaps are flagged", () => {
  const channels: ReportChannel[] = [
    { id: "l1", assetId: "a", code: "T01", name: "Barra fase L1", metric: "temperature", warning: 65, critical: 80 },
    { id: "l2", assetId: "a", code: "T02", name: "Barra fase L2", metric: "temperature", warning: 65, critical: 80 },
    { id: "l3", assetId: "a", code: "T03", name: "Barra fase L3", metric: "temperature", warning: 65, critical: 80 },
    { id: "amb", assetId: "a", code: "A01", name: "Ambiente de cabina", metric: "ambient_temperature", warning: 50, critical: null },
    { id: "hb", assetId: "b", code: "H01", name: "Ambiente de cabina", metric: "humidity", warning: 85, critical: null },
    { id: "sd", assetId: "b", code: "SD1", name: "Descarga superficial", metric: "surface_discharge", warning: 30, critical: null },
    { id: "tb", assetId: "b", code: "T01", name: "Barra fase L1", metric: "temperature", warning: 65, critical: 80 },
  ];
  const buckets: ReportBucket[] = [];
  for (let at = start.getTime() - 7 * 24 * HOUR; at < end.getTime(); at += HOUR) {
    const progress = Math.max(0, (at - start.getTime()) / (end.getTime() - start.getTime()));
    buckets.push({ channelId: "l1", start: at, max: 50, samples: 60 });
    buckets.push({ channelId: "l3", start: at, max: 51, samples: 60 });
    buckets.push({ channelId: "l2", start: at, max: 52 + progress * 14, samples: 60 }); // termina ~66 °C, 15 °C sobre L1
    buckets.push({ channelId: "amb", start: at, max: 25, samples: 60 });
    // Punto b: corte de 6 h el día 18 y humedad alta con descarga superficial algunos días.
    const gap = at >= Date.UTC(2026, 10, 18, 10) && at < Date.UTC(2026, 10, 18, 16);
    if (!gap) {
      const humid = at >= Date.UTC(2026, 10, 10) && at < Date.UTC(2026, 10, 12);
      buckets.push({ channelId: "hb", start: at, max: humid ? 88 : 60, samples: 60 });
      buckets.push({ channelId: "sd", start: at, max: humid && at % (8 * HOUR) === 0 ? 34 : 10, samples: 60 });
      buckets.push({ channelId: "tb", start: at, max: 45, samples: 60 });
    }
  }
  const report = analyzeSiteReport({
    kind: "monthly", now, periodStart: start, periodEnd: end, timezone: "America/Santiago", clientName: "STM",
    site: { id: "s", code: "SITE", name: "Subestación Chicureo" },
    points: [{ id: "a", name: "Celda Algarrobal", device: "CAM5-CTRL-01" }, { id: "b", name: "Trafo Algarrobal", device: "CAM5-CTRL-01" }],
    channels, buckets,
    alarms: [
      { assetId: "a", channelId: "l2", severity: "warning", status: "closed", openedAt: start.getTime() + 20 * 24 * HOUR, acknowledgedAt: start.getTime() + 20 * 24 * HOUR + 10 * 60_000 },
      { assetId: "a", channelId: "l2", severity: "warning", status: "closed", openedAt: start.getTime() + 25 * 24 * HOUR, acknowledgedAt: start.getTime() + 25 * 24 * HOUR + 20 * 60_000 },
      { assetId: "a", channelId: "l2", severity: "warning", status: "open", openedAt: start.getTime() + 29 * 24 * HOUR, acknowledgedAt: null },
    ],
    previousAlarms: [{ assetId: "a", channelId: "l2", severity: "warning", status: "closed", openedAt: start.getTime() - 5 * 24 * HOUR, acknowledgedAt: start.getTime() - 5 * 24 * HOUR + 40 * 60_000 }],
  });

  const celda = report.points.find((point) => point.name === "Celda Algarrobal")!;
  assert.equal(celda.hotPhase, "L2");
  assert.ok(celda.imbalance! >= 12 && celda.imbalance! <= 16, `imbalance ${celda.imbalance}`);
  assert.ok(celda.imbalanceTrendPerWeek! > 2, "the gap keeps growing week over week");
  assert.equal(celda.health, "action");
  assert.ok(celda.riseOverAmbient! >= 40);
  assert.ok(celda.hoursOverWarning > 0);

  const trafo = report.points.find((point) => point.name === "Trafo Algarrobal")!;
  assert.equal(trafo.humidityHours, 48);
  assert.ok(trafo.sdEvents > 0);
  assert.equal(trafo.longestGap?.hours, 6);
  assert.ok(trafo.availabilityPercent! < 100);

  assert.equal(report.actions[0].priority, "now");
  assert.match(report.actions[0].title, /fase L2/);
  assert.ok(report.actions.some((action) => /aislamiento/.test(action.title)), "humid surface discharges point to insulation");
  assert.equal(report.conclusion.tone, "critical");
  assert.equal(report.alarmsSummary.mttaMinutes, 15);
  assert.equal(report.kpis.previousMttaMinutes, 40);
  assert.equal(report.alarmsSummary.unresolved, 1);
  assert.equal(report.alarmsSummary.recurrent[0]?.count, 3);
  assert.equal(report.imbalanceChart?.pointName, "Celda Algarrobal");
  assert.equal(report.imbalanceChart?.series.length, 3);
  assert.equal(report.period.label, "Noviembre de 2026");
});
