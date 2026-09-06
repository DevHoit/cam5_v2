import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { processNotificationQueue } from "../../../../../db/notification-engine";
import { getDb } from "../../../../../db/index";

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
    const result = await processNotificationQueue(getDb());
    return Response.json({ ok: result.failed === 0, processedAt: new Date().toISOString(), ...result }, { status: result.failed === 0 ? 200 : 207, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("No fue posible procesar las notificaciones", error);
    return Response.json({ error: "No fue posible procesar la cola de notificaciones." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
