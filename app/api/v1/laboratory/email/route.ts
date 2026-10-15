import type { NextRequest } from "next/server";
import { provisionLaboratoryCam5, assertLaboratoryEnvironment, prepareLaboratoryEmail, loadLaboratoryEmail, preflightLaboratoryEmail, activateLaboratoryEmail, processLaboratoryEmail, closeLaboratoryEmail } from "../../../../../db/laboratory-email";
import { apiErrorResponse, ApiError, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
async function handle(request: NextRequest) {
  try {
    try { assertLaboratoryEnvironment(process.env); } catch { throw new ApiError(404, "Laboratorio no disponible en este entorno."); }
    const { db, user } = await requireApiSession(request, "notifications.write");
    if (user.roleKey !== "platform_admin") throw new ApiError(403, "El ensayo requiere Administrador HOIT.");
    const body = request.method === "GET" ? { action: "preflight", runId: request.nextUrl.searchParams.get("runId") } : await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "Solicitud inválida.");
    if (request.method === "GET" && !body.runId) return Response.json({ available: true, recipients: ["pruebas@hoitlive.com", "emer.cl+3@gmail.com"], dispatchSkipped: true });
    const action = body.action;
    if (!["provision_cam5", "prepare", "preflight", "activate", "process", "close"].includes(action)) throw new ApiError(400, "Acción no permitida.");
    try {
      if (action === "provision_cam5") return Response.json(await provisionLaboratoryCam5(db, user.siteId, user.id));
      if (action === "prepare") {
        const recipient = typeof body.recipient === "string" ? body.recipient.trim().toLowerCase() : "pruebas@hoitlive.com";
        const run = await prepareLaboratoryEmail(db, user.siteId, user.id, recipient);
        return Response.json({ run, dispatchSkipped: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
      }
      if (typeof body.runId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.runId)) throw new ApiError(400, "Identificador de ensayo inválido.");
      const run = await loadLaboratoryEmail(db, user.siteId, body.runId);
      const result = action === "preflight" ? await preflightLaboratoryEmail(db, run)
        : action === "activate" ? await activateLaboratoryEmail(db, run)
        : action === "process" ? await processLaboratoryEmail(db, run)
        : await closeLaboratoryEmail(db, run);
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Database/provider diagnostics are logged internally, never exposed to the form.
      if (typeof error === "object" && error && "code" in error) throw error;
      throw new ApiError(409, error instanceof Error ? error.message : "El ensayo no pudo continuar.");
    }
  } catch (error) { return apiErrorResponse(error); }
}
export const GET = handle;
export const POST = handle;
