import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getDb } from "../../../../../db/index";
import { processScheduledReports } from "../../../../../db/report-engine";
import { processSiteReportSchedules } from "../../../../../db/site-report-output";

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
    const result = await processScheduledReports(db);
    const site = await processSiteReportSchedules(db);
    const ok = result.failed === 0 && site.failed === 0;
    return Response.json({ ok, processedAt: new Date().toISOString(), ...result, siteReports: site }, { status: ok ? 200 : 207, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("No fue posible procesar los reportes programados", error);
    return Response.json({ error: "No fue posible procesar los reportes programados." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
