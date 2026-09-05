import { eq } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { createGatewayToken, gatewayTokenDisplayPrefix, hashGatewayToken } from "./gateway-auth";
import { closeDb, getDb } from "./index";
import { loadDatabaseEnvironment } from "./load-env";
import { gatewayApiCredentials, gateways } from "./schema";

export async function provisionGatewayToken(gatewayCode: string, name = "Token de ingestión", validityDays = 365) {
  if (!gatewayCode.trim()) throw new Error("Debes indicar el código del gateway.");
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 1825) throw new Error("La vigencia debe estar entre 1 y 1825 días.");
  const db = getDb();
  const matches = await db.select({ id: gateways.id, code: gateways.code, name: gateways.name }).from(gateways)
    .where(eq(gateways.code, gatewayCode.trim().toUpperCase())).limit(2);
  if (!matches.length) throw new Error(`No existe el gateway ${gatewayCode}.`);
  if (matches.length > 1) throw new Error(`El código ${gatewayCode} existe en varios sitios; utiliza un código de gateway globalmente distinguible.`);
  const token = createGatewayToken();
  const expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);
  const [credential] = await db.insert(gatewayApiCredentials).values({
    gatewayId: matches[0].id,
    name,
    tokenPrefix: gatewayTokenDisplayPrefix(token),
    tokenHash: hashGatewayToken(token),
    expiresAt,
  }).returning({ id: gatewayApiCredentials.id });
  return { credentialId: credential.id, gateway: matches[0], token, expiresAt };
}

const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  loadDatabaseEnvironment();
  const gatewayCode = process.argv[2] ?? "";
  const name = process.argv[3] ?? "Token de ingestión";
  const validityDays = process.argv[4] ? Number(process.argv[4]) : 365;
  provisionGatewayToken(gatewayCode, name, validityDays)
    .then((result) => {
      console.log(`Gateway: ${result.gateway.code} · ${result.gateway.name}`);
      console.log(`Expira: ${result.expiresAt.toISOString()}`);
      console.log("Token (se muestra una sola vez):");
      console.log(result.token);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "No fue posible crear la credencial.");
      process.exitCode = 1;
    })
    .finally(closeDb);
}
