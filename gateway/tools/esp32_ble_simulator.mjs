#!/usr/bin/env node
// Simulador del mini gateway BLE (ESP32, hoit-ble-gateway): envía exactamente el JSON que arma
// build_gateway_payload() en main.c, con el encabezado X-HOIT-Token, a /api/v2/gateway/ingest.
//
// Uso:
//   HOIT_TOKEN=cam5gw_… node gateway/tools/esp32_ble_simulator.mjs [url] [código-gateway] [beacons] [intervalo-s]
//   url por omisión: http://localhost:3003 · gateway: HOIT-BLE-1A2B3C · beacons: 2 · intervalo: 30
// Con ONCE=1 envía un solo lote y termina. BASES="3,3,-19" fija la temperatura base de cada beacon
// (por omisión 3 °C, una cámara de refrigeración).

const base = process.argv[2] ?? "http://localhost:3003";
const gateway = process.argv[3] ?? "HOIT-BLE-1A2B3C";
const count = Math.max(1, Math.min(10, Number(process.argv[4] ?? 2)));
const intervalSeconds = Math.max(5, Number(process.argv[5] ?? 30));
const token = process.env.HOIT_TOKEN ?? "";
if (!token.startsWith("cam5gw_")) {
  console.error("Define HOIT_TOKEN con la credencial del gateway (cam5gw_…).");
  process.exit(1);
}

const started = Date.now();
let sequence = 0;
const bases = (process.env.BASES ?? "").split(",").map((value) => Number(value)).filter((value) => Number.isFinite(value));
const macs = Array.from({ length: count }, (_, index) => `C3:00:00:1A:2B:${(0x3c + index).toString(16).toUpperCase().padStart(2, "0")}`);

function beacon(mac, index) {
  const minutes = (Date.now() - started) / 60_000;
  // Cámara fría: 2–4 °C con un ciclo del compresor de ~20 min; el segundo beacon, una puerta que se abre a ratos.
  const temperature = (bases[index] ?? 3) + Math.sin(minutes / 3.2 + index) * 0.9 + (index === 1 && Math.floor(minutes) % 15 === 0 ? 4.5 : 0);
  return {
    mac,
    temperature: Number(temperature.toFixed(1)),
    humidity: Number((84 + Math.cos(minutes / 4 + index) * 3).toFixed(1)),
    // El quinto beacon simula una batería por agotarse.
    battery_percent: index === 4 ? 14 : 96 - index,
    battery_mv: index === 0 ? null : 2950,
    rssi: -64 - index * 7 + Math.round(Math.random() * 4),
    age_ms: 1200 + Math.round(Math.random() * 8000),
  };
}

async function send() {
  sequence += 1;
  const body = { gateway, sequence, uptime_ms: Date.now() - started, beacons: macs.map(beacon) };
  const response = await fetch(`${base}/api/v2/gateway/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-HOIT-Token": token, "User-Agent": "HOIT-BLE-Gateway/1.0 (simulador)" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  console.log(`${new Date().toISOString()} seq=${sequence} → HTTP ${response.status} ${text.slice(0, 240)}`);
}

// Un fallo de red no detiene el simulador: el ESP32 real también reintenta en el siguiente ciclo.
await send().catch((error) => { console.error(String(error)); if (process.env.ONCE === "1") process.exitCode = 1; });
if (process.env.ONCE !== "1") setInterval(() => void send().catch((error) => console.error(String(error))), intervalSeconds * 1000);
