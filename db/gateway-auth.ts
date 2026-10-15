import { createHash, randomBytes } from "node:crypto";

export const GATEWAY_TOKEN_PREFIX = "hoitgw_";
export const LEGACY_GATEWAY_TOKEN_PREFIXES = ["cam5gw_"] as const;

export function isSupportedGatewayToken(token: string): boolean {
  return token.startsWith(GATEWAY_TOKEN_PREFIX)
    || LEGACY_GATEWAY_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix));
}

export function createGatewayToken(): string {
  return `${GATEWAY_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashGatewayToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function gatewayTokenDisplayPrefix(token: string): string {
  return token.slice(0, 18);
}

export function gatewayCredentialRenewalExpiry(currentExpiresAt: Date | null, renewedAt: Date, validityDays: number): Date {
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 1825) throw new Error("La renovación debe estar entre 1 y 1825 días.");
  const renewalBase = currentExpiresAt && currentExpiresAt > renewedAt ? currentExpiresAt : renewedAt;
  return new Date(renewalBase.getTime() + validityDays * 24 * 60 * 60 * 1_000);
}
