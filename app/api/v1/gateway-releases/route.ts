import type { NextRequest } from "next/server";
import { count, desc, eq } from "drizzle-orm";
import { MAX_RELEASE_BYTES, readReleaseBundle, ReleaseBundleError, sha256Hex, verifyReleaseSignature } from "../../../../db/gateway-releases";
import { auditLogs, gatewayReleases, gateways } from "../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

const STAFF_ONLY = "Solo el personal de HOIT administra las versiones del gateway.";

/** Versiones publicadas del software del gateway (sin el paquete), con cuántos equipos la tienen asignada. */
export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "settings.read");
    if (!user.platformStaff) throw new ApiError(403, STAFF_ONLY);
    const assigned = db.select({ releaseId: gateways.targetReleaseId, total: count().as("total") })
      .from(gateways).groupBy(gateways.targetReleaseId).as("assigned");
    const rows = await db.select({
      id: gatewayReleases.id,
      version: gatewayReleases.version,
      sha256: gatewayReleases.sha256,
      sizeBytes: gatewayReleases.sizeBytes,
      notes: gatewayReleases.notes,
      createdAt: gatewayReleases.createdAt,
      assignedGateways: assigned.total,
    }).from(gatewayReleases)
      .leftJoin(assigned, eq(assigned.releaseId, gatewayReleases.id))
      .orderBy(desc(gatewayReleases.createdAt))
      .limit(50);
    return Response.json({
      releases: rows.map((row) => ({ ...row, assignedGateways: Number(row.assignedGateways ?? 0) })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * Publica una versión: multipart con "bundle" (tar.gz de gateway/tools/release), "signature"
 * (texto o archivo .sig, Ed25519 en base64) y "notes" opcional. Se rechaza si la firma no
 * corresponde a la clave de versiones HOIT.
 */
export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "settings.read");
    if (!user.platformStaff) throw new ApiError(403, STAFF_ONLY);
    const form = await request.formData().catch(() => null);
    const file = form?.get("bundle");
    if (!(file instanceof Blob)) throw new ApiError(400, "Adjunta el paquete .tar.gz.");
    if (file.size > MAX_RELEASE_BYTES) throw new ApiError(413, "El paquete supera 4 MB.");
    const signatureField = form?.get("signature");
    const signature = (signatureField instanceof Blob ? await signatureField.text() : String(signatureField ?? "")).trim();
    const notesField = form?.get("notes");
    const notes = typeof notesField === "string" ? notesField.trim().slice(0, 500) || null : null;
    const bundle = Buffer.from(await file.arrayBuffer());

    let manifest;
    try {
      manifest = readReleaseBundle(bundle);
    } catch (error) {
      if (error instanceof ReleaseBundleError) throw new ApiError(400, error.message);
      throw error;
    }
    if (!verifyReleaseSignature(bundle, signature)) {
      throw new ApiError(400, "La firma no corresponde al paquete o no es de la clave de versiones HOIT.");
    }
    const [existing] = await db.select({ id: gatewayReleases.id }).from(gatewayReleases)
      .where(eq(gatewayReleases.version, manifest.version)).limit(1);
    if (existing) throw new ApiError(409, `La versión ${manifest.version} ya está publicada.`);

    const sha256 = sha256Hex(bundle);
    const metadata = requestMetadata(request);
    const [release] = await db.transaction(async (tx) => {
      const inserted = await tx.insert(gatewayReleases).values({
        version: manifest.version,
        sha256,
        signature,
        sizeBytes: bundle.length,
        bundle,
        notes,
        createdBy: user.id,
      }).returning({ id: gatewayReleases.id, version: gatewayReleases.version, createdAt: gatewayReleases.createdAt });
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "gateway_release.create",
        resourceType: "gateway_release",
        resourceId: inserted[0].id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        after: { version: manifest.version, sha256, sizeBytes: bundle.length, files: manifest.files.length },
      });
      return inserted;
    });
    return Response.json({
      release: { ...release, sha256, sizeBytes: bundle.length, notes, files: manifest.files, assignedGateways: 0 },
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
