import { createHash, randomBytes } from "node:crypto";

export const GATEWAY_TOKEN_PREFIX = "cam5gw_";

export function createGatewayToken(): string {
  return `${GATEWAY_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashGatewayToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function gatewayTokenDisplayPrefix(token: string): string {
  return token.slice(0, 18);
}
