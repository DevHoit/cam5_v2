import assert from "node:assert/strict";
import test from "node:test";
import { resolveTrendResolution } from "../app/api/v1/_lib/trend-resolution";

const end = new Date("2026-09-05T12:00:00.000Z");
const before = (milliseconds: number) => new Date(end.getTime() - milliseconds);

test("chooses a useful automatic resolution for each operational range", () => {
  assert.equal(resolveTrendResolution(before(60 * 60_000), end, "auto").key, "raw");
  assert.equal(resolveTrendResolution(before(24 * 60 * 60_000), end, "auto").key, "60");
  assert.equal(resolveTrendResolution(before(30 * 24 * 60 * 60_000), end, "auto").key, "300");
  assert.equal(resolveTrendResolution(before(365 * 24 * 60 * 60_000), end, "auto").key, "3600");
  assert.equal(resolveTrendResolution(before(3 * 365 * 24 * 60 * 60_000), end, "auto").key, "86400");
});

test("rejects an explicit resolution that would overload or misrepresent the chart", () => {
  assert.throws(() => resolveTrendResolution(before(3 * 60 * 60_000), end, "raw"), /no admite un periodo tan extenso/i);
  assert.throws(() => resolveTrendResolution(before(8 * 24 * 60 * 60_000), end, "60"), /no admite un periodo tan extenso/i);
});
