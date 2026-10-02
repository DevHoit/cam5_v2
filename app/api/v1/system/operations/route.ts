import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getDb } from "../../../../../db/index";
import { runOperationalCycle } from "../../../../../db/operations-cycle";

export const dynamic = "force-dynamic";

function validSchedulerToken(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!secret || !token) return false;
  const expected = Buffer.from(secret);
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function run(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: "CRON_SECRET no está configurado." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!validSchedulerToken(request)) {
    return Response.json({ error: "No autorizado." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const result = await runOperationalCycle(getDb());
    return Response.json(result, {
      status: result.ok ? 200 : 207,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("No fue posible ejecutar el ciclo operacional", error);
    return Response.json({ error: "No fue posible ejecutar el ciclo operacional." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
