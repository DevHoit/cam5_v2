import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { sites } from "../../../../../db/schema";
import { operationsPolicy } from "../../../../../db/operations-policy";
import type { NextRequest } from "next/server";
import { getDb } from "../../../../../db/index";
import { runOperationalCycle } from "../../../../../db/operations-cycle";

export const dynamic = "force-dynamic";

function validSchedulerToken(request: NextRequest, secret: string) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!secret || !token) return false;
  const expected = Buffer.from(secret);
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function run(request: NextRequest) {
  let policy: ReturnType<typeof operationsPolicy>;
  try {
    policy = operationsPolicy(process.env);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Scheduler sin configurar." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!validSchedulerToken(request, policy.secret)) {
    return Response.json({ error: "No autorizado." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const db = getDb();
    let siteId: string | undefined;
    if (policy.siteCode) {
      const matches = await db.select({ id: sites.id }).from(sites)
        .where(and(eq(sites.code, policy.siteCode), eq(sites.active, true)));
      if (matches.length !== 1) {
        return Response.json({ error: "El código de sitio de pruebas debe identificar exactamente un sitio activo." }, { status: 503, headers: { "Cache-Control": "no-store" } });
      }
      siteId = matches[0].id;
    }
    const result = await runOperationalCycle(db, { mode: policy.mode, siteId });
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
