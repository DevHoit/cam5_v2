import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db/index";
import { sites } from "../../../../../db/schema";
import { refreshTelemetryAggregates } from "../../../../../db/telemetry-aggregation";

export const dynamic = "force-dynamic";

function validCronToken(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!secret || !token) return false;
  const expected = Buffer.from(secret);
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) return Response.json({ error: "CRON_SECRET no está configurado." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (!validCronToken(request)) return Response.json({ error: "No autorizado." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const db = getDb();
    const activeSites = await db.select({ id: sites.id }).from(sites).where(eq(sites.active, true));
    const evaluatedAt = new Date();
    const results = await Promise.allSettled(activeSites.map((site) => refreshTelemetryAggregates(db, site.id, evaluatedAt)));
    const failures = results.flatMap((result, index) => result.status === "rejected" ? [{ siteId: activeSites[index].id, reason: result.reason instanceof Error ? result.reason.message : "Error desconocido" }] : []);
    if (failures.length) console.error("Falló la agregación de uno o más sitios", failures);
    return Response.json({ ok: failures.length === 0, evaluatedAt: evaluatedAt.toISOString(), sites: activeSites.length, failed: failures.length }, { status: failures.length === 0 ? 200 : 500, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("No fue posible generar los agregados históricos", error);
    return Response.json({ error: "No fue posible generar los agregados históricos." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
