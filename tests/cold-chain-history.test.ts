import assert from "node:assert/strict";
import test from "node:test";
import { detectTemperatureExcursions } from "../db/cold-chain-history";

const t = (iso: string, valueC: number | null, quality = "good") => ({
  recordedAt: new Date(iso),
  valueC,
  quality,
});

test("detects persisted high excursion and ignores short breaches", () => {
  const result = detectTemperatureExcursions({
    points: [
      t("2026-10-02T10:00:00Z", 5),
      t("2026-10-02T10:01:00Z", 9),
      t("2026-10-02T10:03:00Z", 9.5),
      t("2026-10-02T10:07:00Z", 7),
      t("2026-10-02T10:08:00Z", 9),
      t("2026-10-02T10:09:00Z", 7),
    ],
    minimumC: 2,
    maximumC: 8,
    staleAfterSeconds: 180,
    excursionDelaySeconds: 300,
    rangeEnd: new Date("2026-10-02T10:10:00Z"),
  });

  assert.equal(result.filter((item) => item.type === "high").length, 1);
  const high = result.find((item) => item.type === "high");
  assert.equal(high?.startedAt.toISOString(), "2026-10-02T10:01:00.000Z");
  assert.equal(high?.endedAt?.toISOString(), "2026-10-02T10:07:00.000Z");
  assert.equal(high?.extremeC, 9.5);
});

test("separates missing data from thermal excursion", () => {
  const result = detectTemperatureExcursions({
    points: [
      t("2026-10-02T10:00:00Z", 4),
      t("2026-10-02T10:01:00Z", 4.1),
      t("2026-10-02T10:10:00Z", 4.2),
    ],
    minimumC: 2,
    maximumC: 8,
    staleAfterSeconds: 120,
    excursionDelaySeconds: 60,
    rangeEnd: new Date("2026-10-02T10:11:00Z"),
  });

  const gap = result.find((item) => item.type === "data_gap");
  assert.ok(gap);
  assert.equal(gap?.startedAt.toISOString(), "2026-10-02T10:03:00.000Z");
  assert.equal(gap?.endedAt?.toISOString(), "2026-10-02T10:10:00.000Z");
});

test("keeps current excursion active at the end of the range", () => {
  const result = detectTemperatureExcursions({
    points: [
      t("2026-10-02T10:00:00Z", 4),
      t("2026-10-02T10:01:00Z", 1),
      t("2026-10-02T10:06:00Z", 0.5),
    ],
    minimumC: 2,
    maximumC: 8,
    staleAfterSeconds: 600,
    excursionDelaySeconds: 300,
    rangeEnd: new Date("2026-10-02T10:07:00Z"),
  });
  const low = result.find((item) => item.type === "low");
  assert.equal(low?.active, true);
  assert.equal(low?.extremeC, 0.5);
});
