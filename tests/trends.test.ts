import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_AGGREGATE_RETENTION_DAYS } from "../db/aggregate-retention";
import { inferTrendStepSeconds, RAW_TREND_WINDOW_MS, resolveTrendResolution, trendRawCutoff } from "../app/api/v1/_lib/trend-resolution";

test("reads raw samples only for the last day and aligns the cutoff to the bucket", () => {
  const now = new Date("2026-09-05T12:03:27.000Z");
  // Debe ser menor que la retención cruda (7 días) o el tramo intermedio quedaría vacío.
  assert.ok(RAW_TREND_WINDOW_MS <= 24 * 3600 * 1000);
  assert.equal(trendRawCutoff(now, 300).toISOString(), "2026-09-04T12:00:00.000Z");
  assert.equal(trendRawCutoff(now, 60).toISOString(), "2026-09-04T12:03:00.000Z");
  assert.equal(trendRawCutoff(now, 3600).toISOString(), "2026-09-04T12:00:00.000Z");
  assert.equal(trendRawCutoff(now, 86400).toISOString(), "2026-09-04T00:00:00.000Z");
});

const end = new Date("2026-09-05T12:00:00.000Z");
const before = (milliseconds: number) => new Date(end.getTime() - milliseconds);

test("chooses a useful automatic resolution for each operational range", () => {
  assert.equal(resolveTrendResolution(before(60 * 60_000), end, "auto", undefined, end).key, "raw");
  assert.equal(resolveTrendResolution(before(24 * 60 * 60_000), end, "auto", undefined, end).key, "60");
  assert.equal(resolveTrendResolution(before(30 * 24 * 60 * 60_000), end, "auto", undefined, end).key, "300");
  assert.equal(resolveTrendResolution(before(365 * 24 * 60 * 60_000), end, "auto", undefined, end).key, "3600");
  assert.equal(resolveTrendResolution(before(3 * 365 * 24 * 60 * 60_000), end, "auto", undefined, end).key, "86400");
});

test("rejects an explicit resolution that would overload or misrepresent the chart", () => {
  assert.throws(() => resolveTrendResolution(before(3 * 60 * 60_000), end, "raw", undefined, end), /no admite un periodo tan extenso/i);
  assert.throws(() => resolveTrendResolution(before(8 * 24 * 60 * 60_000), end, "60", undefined, end), /no admite un periodo tan extenso/i);
});

test("infers the real gateway cadence for short raw trends", () => {
  const series = [{ points: [
    { timestamp: "2026-09-05T11:45:00.000Z" },
    { timestamp: "2026-09-05T11:50:00.000Z" },
    { timestamp: "2026-09-05T11:55:00.000Z" },
  ] }];
  assert.equal(inferTrendStepSeconds(series, 0), 300);
  assert.equal(inferTrendStepSeconds(series, 60), 60);
  assert.equal(inferTrendStepSeconds([{ points: [] }], 0), 300);
});

test("moves to a coarser automatic resolution when the detail was already removed", () => {
  const retention = { rawDays: 7, aggregateDays: DEFAULT_AGGREGATE_RETENTION_DAYS };
  const day = 24 * 60 * 60_000;
  const range = (startDaysAgo: number, lengthMs: number) => [before(startDaysAgo * day), new Date(end.getTime() - startDaysAgo * day + lengthMs)] as const;
  // Una hora de hace 10 días: ya no hay crudos, pero sí el detalle de 1 minuto (30 días).
  assert.equal(resolveTrendResolution(...range(10, 60 * 60_000), "auto", retention, end).key, "60");
  // Un día de hace 40 días: el minuto ya se borró, queda el de 5 minutos (92 días).
  assert.equal(resolveTrendResolution(...range(40, day), "auto", retention, end).key, "300");
  // Un día de hace 200 días: solo queda el de hora.
  assert.equal(resolveTrendResolution(...range(200, day), "auto", retention, end).key, "3600");
});
