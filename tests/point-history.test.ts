import assert from "node:assert/strict";
import test from "node:test";
import { buildHistory, energyToday, HISTORY_BUCKET_SECONDS, localMidnight } from "../db/point-history";

const step = HISTORY_BUCKET_SECONDS * 1000;
const from = new Date("2026-11-20T00:00:00Z");
const now = new Date(from.getTime() + 12 * step);
const bucket = (index: number, max: number, channelId = "a", avg = max) => ({ channelId, start: new Date(from.getTime() + index * step), avg, min: avg, max, first: avg, last: avg });
const cold = { rangeMin: 0, rangeMax: 5, toleranceMinutes: 10, aggregation: "max" as const };

test("builds the 24 h curve from the worst sensor and counts excursions across gaps", () => {
  const buckets = [
    bucket(0, 3), bucket(0, 4, "b"),
    bucket(1, 6), bucket(2, 7), // excursión de 10 min
    bucket(3, 3),
    // intervalo 4 sin datos
    bucket(5, 2), bucket(6, 2.5),
    bucket(8, 5.5), bucket(10, 6.2), bucket(11, 6.8), // excursión en curso, con un hueco al medio
  ];
  const history = buildHistory(buckets, cold, from, now);
  assert.deepEqual(history.values.slice(0, 4), [4, 6, 7, 3], "max across sensors per bucket");
  assert.equal(history.values[4], null);
  assert.equal(history.excursions, 2);
  assert.equal(history.outMinutes, 25);
  assert.equal(history.min, 2);
  assert.equal(history.max, 7);
  assert.equal(history.inRangePct, 44.4);
  assert.equal(history.outSince, new Date(from.getTime() + 8 * step).toISOString(), "the open excursion started at bucket 8");
  assert.equal(history.trend, 1.3, "6.8 now vs 5.5 three buckets earlier");
});

test("a point back in range has no open excursion and no range means no percentage", () => {
  const recovered = buildHistory([bucket(9, 7), bucket(10, 3), bucket(11, 3.1)], cold, from, now);
  assert.equal(recovered.outSince, null);
  assert.equal(recovered.excursions, 1);
  const panel = buildHistory([bucket(10, 40, "a", 40), bucket(10, 12, "b", 12)], { rangeMin: null, rangeMax: null, toleranceMinutes: 0, aggregation: "sum" }, from, now);
  assert.equal(panel.values[10], 52, "a panel sums its meters");
  assert.equal(panel.inRangePct, null);
});

test("energy today is the counter difference since local midnight and demand peaks sum meters", () => {
  const midnight = localMidnight(new Date("2026-11-20T15:30:00Z"), "America/Santiago");
  assert.equal(midnight.toISOString(), "2026-11-20T03:00:00.000Z");
  const at = (minutes: number) => new Date(midnight.getTime() + minutes * 60_000);
  const power = [
    { channelId: "tg", start: at(-5), avg: 99, min: 99, max: 99, first: 99, last: 99 },
    { channelId: "tg", start: at(600), avg: 50, min: 50, max: 50, first: 50, last: 50 },
    { channelId: "tc", start: at(600), avg: 20, min: 20, max: 20, first: 20, last: 20 },
    { channelId: "tg", start: at(700), avg: 60, min: 60, max: 60, first: 60, last: 60 },
  ];
  const energy = [
    { channelId: "e1", start: at(0), avg: 1000, min: 1000, max: 1001, first: 1000, last: 1001 },
    { channelId: "e1", start: at(700), avg: 1250, min: 1250, max: 1250.5, first: 1250, last: 1250.5 },
    { channelId: "e2", start: at(5), avg: 10, min: 10, max: 10, first: 10, last: 10 },
    { channelId: "e2", start: at(800), avg: 4, min: 4, max: 4, first: 4, last: 4 },
  ];
  const today = energyToday(power, energy, midnight);
  assert.equal(today.peakKw, 70, "10:00 local: 50 + 20 kW (the value before midnight does not count)");
  assert.equal(today.peakAt, at(600).toISOString());
  assert.equal(today.kwh, 250.5, "a counter that resets adds nothing");
});

test("a cold room bucket takes the sensor farthest outside the range, below the minimum too", () => {
  const freezing = buildHistory([bucket(10, 3), { channelId: "b", start: new Date(from.getTime() + 10 * step), avg: -1, min: -2, max: -0.5, first: -1, last: -1 }], cold, from, now);
  assert.equal(freezing.values[10], -2);
  assert.equal(freezing.excursions, 1);
});
