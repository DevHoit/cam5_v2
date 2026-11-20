import assert from "node:assert/strict";
import test from "node:test";
import { alarmCopy } from "../db/alarm-engine";

test("threshold alarm details round scaled readings", () => {
  const copy = alarmCopy({ kind: "threshold", severity: "warning", channelCode: "H01", channelName: "Ambiente de cabina", zone: "Compartimiento de cables", value: 798 * 0.1, unit: "%RH", threshold: 75 });
  assert.equal(copy.detail, "Ambiente de cabina · Compartimiento de cables. Valor 79.8 %RH; umbral 75 %RH.");
  assert.match(alarmCopy({ kind: "threshold", severity: "critical", channelCode: "T02", channelName: "Barra", zone: null, value: null, unit: "°C", threshold: 75.25 }).detail, /Valor — °C; umbral 75.25 °C/);
});
