import { createHash, createPublicKey, verify } from "node:crypto";
import { gunzipSync } from "node:zlib";

/**
 * Versiones de software del gateway (actualización remota).
 *
 * Un paquete es un tar.gz con `VERSION` y `files/<ruta absoluta>` (ver gateway/c/deploy/sim7600/hoit_update.sh).
 * Se firma fuera de Core con Ed25519 (gateway/tools/release); Core comprueba la firma al publicarlo,
 * pero quien decide es el gateway, que la vuelve a verificar con la clave pública grabada en su binario.
 */

/** Clave pública Ed25519 de las versiones HOIT (la misma que RELEASE_PUBLIC_KEY en gateway/c/src/update.c). */
export const RELEASE_PUBLIC_KEY_BASE64 = "Gexjc4a3fY4i3KV/9yFkno2nT1IHTJrtsxwPsX+MV1g=";

/** El gateway acepta hasta 4 MiB y Vercel limita el cuerpo de una solicitud a 4,5 MB. */
export const MAX_RELEASE_BYTES = 4 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,38}$/;
const ALLOWED_PREFIXES = ["/cache/cam5-gateway/", "/data/hoit/bin/", "/data/hoit/www/", "/etc/init.d/"];
const PROTECTED_PATHS = new Set(["/cache/cam5-gateway/gateway.env", "/cache/cam5-gateway/config.json", "/cache/cam5-gateway/config.etag"]);

export class ReleaseBundleError extends Error {}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function releasePublicKey(base64 = RELEASE_PUBLIC_KEY_BASE64) {
  const raw = Buffer.from(base64, "base64");
  if (raw.length !== 32) throw new Error("Clave pública de versiones inválida.");
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

export function verifyReleaseSignature(bundle: Buffer, signatureBase64: string, publicKeyBase64?: string): boolean {
  const signature = Buffer.from(signatureBase64.trim(), "base64");
  if (signature.length !== 64) return false;
  try {
    return verify(null, bundle, releasePublicKey(publicKeyBase64), signature);
  } catch {
    return false;
  }
}

export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function tarString(block: Buffer, offset: number, length: number): string {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8");
}

export type ReleaseManifest = { version: string; files: string[] };

/** Lee VERSION y la lista de archivos del paquete y valida las rutas igual que el instalador. */
export function readReleaseBundle(bundle: Buffer): ReleaseManifest {
  if (bundle.length === 0 || bundle.length > MAX_RELEASE_BYTES) throw new ReleaseBundleError("El paquete debe pesar entre 1 byte y 4 MB.");
  let tar: Buffer;
  try {
    tar = gunzipSync(bundle, { maxOutputLength: MAX_UNPACKED_BYTES });
  } catch {
    throw new ReleaseBundleError("El paquete no es un tar.gz válido.");
  }
  let version: string | null = null;
  const files: string[] = [];
  let longName: string | null = null;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = Number.parseInt(tarString(header, 124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) throw new ReleaseBundleError("Encabezado tar inválido.");
    const type = String.fromCharCode(header[156] || 48);
    const prefix = tarString(header, 345, 155);
    let name = longName ?? (prefix ? `${prefix}/${tarString(header, 0, 100)}` : tarString(header, 0, 100));
    longName = null;
    const dataStart = offset + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / 512) * 512;
    if (type === "L") { longName = tarString(data, 0, data.length); continue; } // nombre largo GNU
    if (type === "x" || type === "g") continue; // atributos extendidos pax
    name = name.replace(/^\.\//, "");
    if (type === "0" || type === "\0") {
      if (name === "VERSION") version = data.toString("utf8").trim();
      else if (name.startsWith("files/")) {
        const target = name.slice("files".length);
        if (target.includes("/../") || target.endsWith("/..")) throw new ReleaseBundleError(`Ruta inválida en el paquete: ${target}`);
        if (PROTECTED_PATHS.has(target) || !ALLOWED_PREFIXES.some((allowed) => target.startsWith(allowed))) {
          throw new ReleaseBundleError(`El paquete instala fuera de las rutas permitidas: ${target}`);
        }
        files.push(target);
      }
    } else if (type === "2" || type === "1") {
      throw new ReleaseBundleError(`El paquete no puede contener enlaces (${name}).`);
    }
  }
  if (!version || !VERSION_PATTERN.test(version)) throw new ReleaseBundleError("El paquete no tiene un archivo VERSION válido.");
  if (!files.includes("/cache/cam5-gateway/cam5-gateway")) throw new ReleaseBundleError("El paquete no incluye el binario /cache/cam5-gateway/cam5-gateway.");
  return { version, files };
}

export type ReleaseOffer = { version: string; sha256: string; signature: string; size: number; attempt: string };

/**
 * Lo que el heartbeat le indica al gateway. Solo se ofrece si la versión asignada difiere de la que
 * el equipo informó; "attempt" cambia con cada asignación para que el equipo reintente una versión
 * que antes falló solo cuando el personal la vuelve a asignar.
 */
export function releaseOffer(
  target: { version: string; sha256: string; signature: string; sizeBytes: number } | null,
  reportedVersion: string | null | undefined,
  assignedAt: Date | null,
): ReleaseOffer | null {
  if (!target || target.version === reportedVersion) return null;
  return {
    version: target.version,
    sha256: target.sha256,
    signature: target.signature,
    size: target.sizeBytes,
    attempt: assignedAt ? Math.floor(assignedAt.getTime() / 1000).toString(36) : "0",
  };
}
