/** Tamaño máximo del logo de un cliente. Un logo optimizado rara vez supera los 100 KB. */
export const MAX_CLIENT_LOGO_BYTES = 300 * 1024;

export const CLIENT_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;
export type ClientLogoType = (typeof CLIENT_LOGO_TYPES)[number];

export class ClientLogoError extends Error {}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((value, index) => bytes[offset + index] === value);
}

/** Detecta el formato real por su firma, sin confiar en la extensión ni en el Content-Type enviado. */
export function detectClientLogoType(bytes: Uint8Array): ClientLogoType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 1024)).replace(/^﻿/, "").trimStart().toLowerCase();
  if (head.startsWith("<svg") || ((head.startsWith("<?xml") || head.startsWith("<!--")) && head.includes("<svg"))) return "image/svg+xml";
  return null;
}

/**
 * Rechaza SVG con contenido activo o referencias externas. El logo se muestra con <img>
 * (que nunca ejecuta scripts) y se sirve con CSP "sandbox", pero no se almacena nada ejecutable.
 */
function assertSafeSvg(bytes: Uint8Array) {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).toLowerCase();
  const forbidden = [
    /<script\b/,
    /<foreignobject\b/,
    /<iframe\b|<embed\b|<object\b/,
    /\son[a-z]+\s*=/,
    /javascript:/,
    /<!entity\b|<!doctype\b/,
    /(?:xlink:)?href\s*=\s*["']\s*(?!#|data:image\/)/,
    /url\(\s*["']?\s*(?!#|data:image\/)/,
    /@import\b/,
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new ClientLogoError("El SVG contiene scripts, eventos o referencias externas. Exporta el logo como SVG simple o PNG.");
  }
}

export function validateClientLogo(bytes: Uint8Array): { contentType: ClientLogoType; base64: string } {
  if (!bytes.length) throw new ClientLogoError("El archivo del logo está vacío.");
  if (bytes.length > MAX_CLIENT_LOGO_BYTES) throw new ClientLogoError(`El logo no puede superar ${Math.round(MAX_CLIENT_LOGO_BYTES / 1024)} KB.`);
  const contentType = detectClientLogoType(bytes);
  if (!contentType) throw new ClientLogoError("Formato no admitido. Usa PNG, JPG, WebP o SVG.");
  if (contentType === "image/svg+xml") assertSafeSvg(bytes);
  return { contentType, base64: Buffer.from(bytes).toString("base64") };
}
