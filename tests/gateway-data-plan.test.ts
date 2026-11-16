import assert from "node:assert/strict";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { checkGatewayDataAlert, DataPlanInputError, parseDataPlanInput, readDataAlert, readDataPlan } from "../db/gateway-data-plan";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import { createMigratedTestDatabase } from "./helpers/database";

test("reads the 4G plan with a 500 MB default and validates edits", () => {
  assert.deepEqual(readDataPlan({}), { planMb: 500, alertMb: 450 });
  assert.deepEqual(readDataPlan({ dataPlan: { planMb: 1000, alertMb: 900 } }), { planMb: 1000, alertMb: 900 });
  assert.deepEqual(readDataPlan({ dataPlan: { planMb: 1000 } }), { planMb: 1000, alertMb: 900 });
  assert.deepEqual(parseDataPlanInput({ planMb: "1000", alertMb: 900 }), { planMb: 1000, alertMb: 900 });
  assert.throws(() => parseDataPlanInput({ planMb: 500, alertMb: 600 }), DataPlanInputError);
  assert.throws(() => parseDataPlanInput({ planMb: 0, alertMb: 0 }), DataPlanInputError);
  assert.throws(() => parseDataPlanInput({ planMb: 500.5, alertMb: 400 }), DataPlanInputError);
});

test("emails platform staff once per month and threshold, and re-arms when the plan is raised", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { adminEmail: "staff@hoit.test", adminName: "HOIT", adminPassword: "Cam5-Prueba-2026", log: false });
    const [site] = await db.select().from(schema.sites).limit(1);
    const [administrator] = await db.select().from(schema.roles).where(eq(schema.roles.key, "administrator")).limit(1);
    const [siteAdmin] = await db.insert(schema.users).values({ email: "admin@cliente.test", displayName: "Admin sitio", status: "active" }).returning();
    await db.insert(schema.userRoleAssignments).values({ userId: siteAdmin.id, roleId: administrator.id, siteId: site.id });
    const [gateway] = await db.select().from(schema.gateways).limit(1);

    const sent: Array<{ to: string[]; subject: string }> = [];
    let fail = false;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      if (fail) return new Response(JSON.stringify({ message: "caído" }), { status: 503 });
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: `email-${sent.length}` }), { status: 200 });
    }) as typeof fetch;
    const environment = { RESEND_API_KEY: "re_test", NOTIFICATION_FROM_EMAIL: "avisos@hoit.test" } as unknown as NodeJS.ProcessEnv;
    const report = (month: string, usedMb: number) => db.update(schema.gateways)
      .set({ metadata: sql`coalesce(${schema.gateways.metadata}, '{}'::jsonb) || ${JSON.stringify({ health: { lteMonth: month, lteMonthMb: usedMb } })}::jsonb` })
      .where(eq(schema.gateways.id, gateway.id));
    const check = () => checkGatewayDataAlert(db, gateway.id, { fetchImpl, environment });

    await report("2026-11", 300);
    assert.equal(await check(), null, "below the 450 MB default threshold");

    await report("2026-11", 452.4);
    const first = await check();
    assert.equal(first?.alertMb, 450);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ["staff@hoit.test"], "only platform staff, never the site administrator");
    assert.match(sent[0].subject, /452,4 MB de 500 MB/);

    await report("2026-11", 470);
    assert.equal(await check(), null, "one email per month and threshold");
    assert.equal(sent.length, 1);

    // El día 20 se sube el plan a 1 GB: el tope pasa a 900 MB y el aviso queda armado de nuevo.
    await db.update(schema.gateways)
      .set({ metadata: sql`${schema.gateways.metadata} || ${JSON.stringify({ dataPlan: { planMb: 1000, alertMb: 900 } })}::jsonb` })
      .where(eq(schema.gateways.id, gateway.id));
    assert.equal(await check(), null, "470 MB is below the new 900 MB threshold");
    await report("2026-11", 905);
    fail = true;
    await assert.rejects(check, /503/);
    const [afterFailure] = await db.select({ metadata: schema.gateways.metadata }).from(schema.gateways).where(eq(schema.gateways.id, gateway.id));
    assert.equal(readDataAlert(afterFailure.metadata)?.alertMb, 450, "a failed email releases the claim so the next heartbeat retries");
    fail = false;
    assert.equal((await check())?.alertMb, 900);
    assert.equal(sent.length, 2);

    await report("2026-12", 905);
    assert.equal((await check())?.month, "2026-12", "a new month re-arms the alert");
    assert.equal(sent.length, 3);
  } finally {
    await client.close();
  }
});
