import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Resuelve un nombre a todas sus direcciones IP (A y AAAA). */
export type HostResolver = (hostname: string) => Promise<string[]>;

export const resolveHostAddresses: HostResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

function normalizeHost(hostname: string) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

/** Rechaza destinos locales o de red privada escritos directamente como nombre o IP. */
export function isInternalHostname(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (!host || host === "localhost" || /\.(localhost|local|internal|lan|home\.arpa)$/.test(host)) return true;
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (isIP(host) === 6) {
    if (host === "::" || host === "::1") return true;
    // IPv4 mapeada: la URL la normaliza a ::ffff:7f00:1 y DNS puede entregarla como ::ffff:127.0.0.1.
    const dotted = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (dotted) return isInternalHostname(dotted[1]);
    const mapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) {
      const high = Number.parseInt(mapped[1], 16);
      const low = Number.parseInt(mapped[2], 16);
      return isInternalHostname(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    // fc00::/7 únicas locales, fe80::/10 enlace local, fec0::/10 sitio local, ff00::/8 multicast.
    return /^(fc|fd|fe[89a-f]|ff)/.test(host);
  }
  return false;
}

export type DestinationCheck =
  | { ok: true }
  | { ok: false; reason: "internal" | "unresolved" };

/**
 * Comprueba que el destino sea público: el nombre escrito y todas las direcciones a las
 * que resuelve. Cubre nombres como 127.0.0.1.nip.io que apuntan a la red interna.
 */
export async function checkPublicDestination(hostname: string, resolve: HostResolver = resolveHostAddresses): Promise<DestinationCheck> {
  const host = normalizeHost(hostname);
  if (isInternalHostname(host)) return { ok: false, reason: "internal" };
  if (isIP(host)) return { ok: true };
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { ok: false, reason: "unresolved" };
  }
  if (!addresses.length) return { ok: false, reason: "unresolved" };
  return addresses.some((address) => isInternalHostname(address)) ? { ok: false, reason: "internal" } : { ok: true };
}
