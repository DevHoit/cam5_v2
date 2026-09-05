import assert from "node:assert/strict";
import test from "node:test";

test("Backend API - health endpoint", async () => {
  const { GET } = await import("../app/api/v1/health/route.ts");
  const res = await GET();
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, "ok");
  assert.equal(data.gateway, "online");
});

test("Backend API - device & discovery", async () => {
  const deviceRoute = await import("../app/api/v1/devices/[deviceId]/route.ts");
  const discoverRoute = await import("../app/api/v1/gateways/[gatewayId]/devices/discover/route.ts");

  const getRes = await deviceRoute.GET(new Request("http://localhost/api/v1/devices/CAM5-01"), {
    params: Promise.resolve({ deviceId: "CAM5-01" }),
  });
  assert.equal(getRes.status, 200);
  const device = await getRes.json();
  assert.equal(device.id, "CAM5-01");
  assert.equal(device.model, "IntelliSAW CAM-5");

  const discRes = await discoverRoute.POST(
    new Request("http://localhost/api/v1/gateways/GW-01/devices/discover", { method: "POST" }),
    { params: Promise.resolve({ gatewayId: "GW-01" }) }
  );
  assert.equal(discRes.status, 200);
  const discData = await discRes.json();
  assert.equal(discData.id, "CAM5-01");
});

test("Backend API - register catalog & modbus test", async () => {
  const registersRoute = await import("../app/api/v1/devices/[deviceId]/registers/route.ts");
  const testModbusRoute = await import("../app/api/v1/devices/[deviceId]/modbus/test/route.ts");

  const regRes = await registersRoute.GET();
  assert.equal(regRes.status, 200);
  const registers = await regRes.json();
  assert.equal(registers.length, 105);

  const testRes = await testModbusRoute.POST();
  assert.equal(testRes.status, 200);
  const testData = await testRes.json();
  assert.equal(testData.ok, true);
  assert.equal(testData.registerCount, 105);
});

test("Backend API - telemetry readings & trends", async () => {
  const latestRoute = await import("../app/api/v1/assets/[assetId]/readings/latest/route.ts");
  const trendsRoute = await import("../app/api/v1/assets/[assetId]/trends/route.ts");

  const latestRes = await latestRoute.GET(
    new Request("http://localhost/api/v1/assets/MCC-01/readings/latest"),
    { params: Promise.resolve({ assetId: "MCC-01" }) }
  );
  assert.equal(latestRes.status, 200);
  const readings = await latestRes.json();
  assert.ok(readings.length > 0);

  const trendRes = await trendsRoute.GET(
    new Request("http://localhost/api/v1/assets/MCC-01/trends?channelId=T01"),
    { params: Promise.resolve({ assetId: "MCC-01" }) }
  );
  assert.equal(trendRes.status, 200);
  const trendData = await trendRes.json();
  assert.ok(Array.isArray(trendData));
});

test("Backend API - alarms & work orders", async () => {
  const alarmsRoute = await import("../app/api/v1/alarms/route.ts");
  const ackRoute = await import("../app/api/v1/alarms/[alarmId]/acknowledge/route.ts");
  const workOrdersRoute = await import("../app/api/v1/work-orders/route.ts");

  const alarmRes = await alarmsRoute.GET(new Request("http://localhost/api/v1/alarms?status=open"));
  assert.equal(alarmRes.status, 200);
  const alarmList = await alarmRes.json();
  assert.ok(alarmList.length > 0);

  const ackRes = await ackRoute.POST(
    new Request("http://localhost/api/v1/alarms/AL-260811-031/acknowledge", {
      method: "POST",
      body: JSON.stringify({ note: "Acción en revisión" }),
    }),
    { params: Promise.resolve({ alarmId: "AL-260811-031" }) }
  );
  assert.equal(ackRes.status, 200);
  const ackData = await ackRes.json();
  assert.equal(ackData.status, "acknowledged");

  const woListRes = await workOrdersRoute.GET();
  assert.equal(woListRes.status, 200);
  const woList = await woListRes.json();
  assert.ok(woList.length > 0);
});

test("Backend API - channels & relays", async () => {
  const channelsRoute = await import("../app/api/v1/devices/[deviceId]/channels/route.ts");
  const relaysRoute = await import("../app/api/v1/devices/[deviceId]/relays/route.ts");

  const chRes = await channelsRoute.GET(
    new Request("http://localhost/api/v1/devices/CAM5-01/channels"),
    { params: Promise.resolve({ deviceId: "CAM5-01" }) }
  );
  assert.equal(chRes.status, 200);
  const channels = await chRes.json();
  assert.ok(channels.length > 0);

  const relayRes = await relaysRoute.GET(
    new Request("http://localhost/api/v1/devices/CAM5-01/relays"),
    { params: Promise.resolve({ deviceId: "CAM5-01" }) }
  );
  assert.equal(relayRes.status, 200);
  const relays = await relayRes.json();
  assert.equal(relays.length, 6);
});
