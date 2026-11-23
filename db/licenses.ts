import { and, countDistinct, eq, inArray, ne, type SQL } from "drizzle-orm";
import type { Cam5Executor } from "./cam5-provisioning";
import { clients, userClientAssignments, users } from "./schema";

/**
 * Licencias de usuario por cliente.
 *
 * - "client": usuarios del propio cliente (p. ej. 5 para SAESA STM).
 * - "partner": usuarios del integrador que administra al cliente (p. ej. 1 administrador de Babcock Briones).
 *
 * Ocupan licencia los usuarios activos o invitados que no son personal de HOIT ni cuentas de prueba de HOIT. Un usuario suspendido la libera.
 * Un límite null significa sin límite. Si un cliente ya está sobre el límite (p. ej. se bajó después), los
 * usuarios existentes siguen funcionando; solo se impide sumar nuevos.
 */
export const LICENSE_KINDS = ["client", "partner"] as const;
export type LicenseKind = typeof LICENSE_KINDS[number];

export type ClientLicenses = {
  clientId: string;
  clientName: string;
  userLimit: number | null;
  userUsed: number;
  partnerName: string | null;
  partnerLimit: number | null;
  partnerUsed: number;
};

type Executor = Pick<Cam5Executor, "select">;

export class LicenseLimitError extends Error {}

export function isLicenseKind(value: unknown): value is LicenseKind {
  return typeof value === "string" && (LICENSE_KINDS as readonly string[]).includes(value);
}

/** Estado que ocupa licencia. */
export function statusUsesLicense(status: string) {
  return status === "active" || status === "invited";
}

async function countUsage(db: Executor, clientIds: string[], excludeUserId?: string) {
  if (!clientIds.length) return [];
  const filters: SQL[] = [
    inArray(userClientAssignments.clientId, clientIds),
    inArray(users.status, ["active", "invited"]),
    eq(users.platformStaff, false),
    // Las cuentas de prueba de HOIT tampoco ocupan licencia del cliente.
    eq(users.testAccount, false),
  ];
  if (excludeUserId) filters.push(ne(users.id, excludeUserId));
  return db.select({ clientId: userClientAssignments.clientId, kind: userClientAssignments.licenseKind, used: countDistinct(users.id) })
    .from(userClientAssignments)
    .innerJoin(users, eq(users.id, userClientAssignments.userId))
    .where(and(...filters))
    .groupBy(userClientAssignments.clientId, userClientAssignments.licenseKind);
}

export async function loadClientLicenses(db: Executor, clientIds: string[]): Promise<ClientLicenses[]> {
  const ids = [...new Set(clientIds)];
  if (!ids.length) return [];
  const [rows, usage] = await Promise.all([
    db.select({ id: clients.id, name: clients.name, userLimit: clients.userLicenseLimit, partnerName: clients.partnerName, partnerLimit: clients.partnerLicenseLimit })
      .from(clients).where(inArray(clients.id, ids)),
    countUsage(db, ids),
  ]);
  return rows.map((row) => ({
    clientId: row.id,
    clientName: row.name,
    userLimit: row.userLimit,
    userUsed: Number(usage.find((item) => item.clientId === row.id && item.kind === "client")?.used ?? 0),
    partnerName: row.partnerName,
    partnerLimit: row.partnerLimit,
    partnerUsed: Number(usage.find((item) => item.clientId === row.id && item.kind === "partner")?.used ?? 0),
  }));
}

/**
 * Comprueba que hay licencia libre para que `userId` (o un usuario nuevo) ocupe una de tipo `kind` en cada
 * cliente. Bloquea las filas de los clientes para que dos altas simultáneas no superen el límite: llamar
 * dentro de la transacción que crea o actualiza las asignaciones.
 */
export async function assertLicensesAvailable(tx: Cam5Executor, requests: Array<{ clientId: string; kind: LicenseKind }>, userId?: string) {
  if (!requests.length) return;
  const ids = [...new Set(requests.map((item) => item.clientId))].sort();
  const rows = await tx.select({ id: clients.id, name: clients.name, userLimit: clients.userLicenseLimit, partnerName: clients.partnerName, partnerLimit: clients.partnerLicenseLimit })
    .from(clients).where(inArray(clients.id, ids)).orderBy(clients.id).for("update");
  const usage = await countUsage(tx, ids, userId);
  for (const { clientId, kind } of requests) {
    const client = rows.find((row) => row.id === clientId);
    if (!client) continue;
    if (kind === "partner" && !client.partnerName) {
      throw new LicenseLimitError(`${client.name} no tiene un integrador configurado.`);
    }
    const limit = kind === "client" ? client.userLimit : client.partnerLimit;
    if (limit === null) continue;
    const used = Number(usage.find((item) => item.clientId === clientId && item.kind === kind)?.used ?? 0);
    if (used >= limit) {
      const seats = limit === 0 ? "no tiene licencias" : limit === 1 ? "ya usa su única licencia" : `ya usa sus ${limit} licencias`;
      throw new LicenseLimitError(kind === "client"
        ? `${client.name} ${seats} de usuario. Suspende o quita un usuario para liberar una, o solicita más licencias a HOIT.`
        : `${client.partnerName} ${seats} de integrador en ${client.name}. Suspende o quita uno de sus usuarios, o solicita más licencias a HOIT.`);
    }
  }
}
