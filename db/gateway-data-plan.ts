import { and, eq, sql } from "drizzle-orm";
import { appBaseUrl } from "./app-url";
import type { Cam5Database } from "./index";
import { gateways, sites, users } from "./schema";

/**
 * Plan de datos 4G por gateway y alerta de consumo. El gateway informa el consumo del mes en su
 * heartbeat (health.lteMonth / health.lteMonthMb). Al llegar al tope se avisa una sola vez por
 * mes y tope al personal de la plataforma (users.platform_staff): los administradores de sitio no
 * gestionan las SIM. Si se sube el plan a mitad de mes, se sube el tope y el aviso vuelve a quedar
 * armado para el tope nuevo.
 */
export const DEFAULT_DATA_PLAN_MB = 500;
export const DEFAULT_ALERT_RATIO = 0.9;
export const MAX_DATA_PLAN_MB = 1_000_000;

export type DataPlan = { planMb: number; alertMb: number };
export type DataAlertState = { month: string; alertMb: number; usedMb: number; sentAt: string; recipients: number };

function positiveInteger(value: unknown): number | null {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number > 0 ? number : null;
}

export function readDataPlan(metadata: Record<string, unknown> | null | undefined): DataPlan {
  const stored = metadata?.dataPlan as Record<string, unknown> | undefined;
  const planMb = positiveInteger(stored?.planMb) ?? DEFAULT_DATA_PLAN_MB;
  const alertMb = positiveInteger(stored?.alertMb) ?? Math.round(planMb * DEFAULT_ALERT_RATIO);
  return { planMb, alertMb: Math.min(alertMb, planMb) };
}

export function readDataAlert(metadata: Record<string, unknown> | null | undefined): DataAlertState | null {
  const stored = metadata?.dataAlert as Partial<DataAlertState> | undefined;
  return stored && typeof stored.month === "string" && typeof stored.alertMb === "number" ? stored as DataAlertState : null;
}

export class DataPlanInputError extends Error {}

export function parseDataPlanInput(body: unknown): DataPlan {
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const planMb = positiveInteger(input.planMb);
  const alertMb = positiveInteger(input.alertMb);
  if (!planMb || planMb > MAX_DATA_PLAN_MB) throw new DataPlanInputError("El plan debe ser un número entero de MB mayor que cero.");
  if (!alertMb) throw new DataPlanInputError("El tope de aviso debe ser un número entero de MB mayor que cero.");
  if (alertMb > planMb) throw new DataPlanInputError("El tope de aviso no puede superar el plan.");
  return { planMb, alertMb };
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

type AlertMessage = { gatewayCode: string; gatewayName: string; siteName: string; month: string; usedMb: number; plan: DataPlan; portalUrl: string };

export function dataAlertEmail(message: AlertMessage) {
  const percent = Math.round((message.usedMb / message.plan.planMb) * 100);
  const used = message.usedMb.toFixed(1).replace(".", ",");
  const subject = `Consumo 4G · ${message.gatewayCode} lleva ${used} MB de ${message.plan.planMb} MB (${percent} %)`;
  const lines = [
    `El gateway ${message.gatewayCode} (${message.gatewayName}) del sitio ${message.siteName} superó el tope de aviso de datos 4G.`,
    "",
    `Mes: ${message.month}`,
    `Consumo: ${used} MB (${percent} % del plan)`,
    `Plan: ${message.plan.planMb} MB · tope de aviso: ${message.plan.alertMb} MB`,
    "",
    "Si se amplía el plan con la operadora, actualiza el plan y el tope en Provisionamiento → Equipos en terreno.",
    message.portalUrl,
  ];
  const rows: Array<[string, string]> = [
    ["Gateway", `${message.gatewayCode} · ${message.gatewayName}`],
    ["Sitio", message.siteName],
    ["Mes", message.month],
    ["Consumo", `${used} MB (${percent} % del plan)`],
    ["Plan / tope de aviso", `${message.plan.planMb} MB / ${message.plan.alertMb} MB`],
  ];
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f4f5f7;color:#18181b;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:100%;background:#fff;border:1px solid #e4e4e7;border-radius:14px;overflow:hidden;">
<tr><td style="padding:20px 26px;background:#0a0b0d;border-bottom:3px solid #d97706;color:#fafafa;font-size:18px;font-weight:800;">HoitLive <span style="color:#8b8d94;font-weight:500;">Core</span><div style="margin-top:3px;color:#71717a;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Plan de datos 4G</div></td></tr>
<tr><td style="padding:26px;">
<h1 style="margin:0 0 10px;font-size:22px;line-height:1.25;">${escapeHtml(message.gatewayCode)} superó el tope de aviso</h1>
<p style="margin:0 0 18px;color:#52525b;font-size:14px;line-height:1.6;">El consumo 4G del mes llegó a ${escapeHtml(used)} MB de un plan de ${message.plan.planMb} MB.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size:14px;">${rows.map(([label, value]) => `<tr><td style="padding:7px 0;color:#71717a;width:42%;border-bottom:1px solid #f4f4f5;">${escapeHtml(label)}</td><td style="padding:7px 0;border-bottom:1px solid #f4f4f5;font-weight:600;">${escapeHtml(value)}</td></tr>`).join("")}</table>
<p style="margin:18px 0 0;color:#52525b;font-size:13px;line-height:1.6;">Si amplías el plan con la operadora, actualiza el plan y el tope en <strong>Provisionamiento → Equipos en terreno</strong>; el aviso queda armado para el tope nuevo.</p>
<div style="padding-top:18px;"><a href="${escapeHtml(message.portalUrl)}" style="display:inline-block;padding:11px 17px;border-radius:9px;background:#0284c7;color:#fff;text-decoration:none;font-size:14px;font-weight:700;">Abrir en HoitLive Core&nbsp;&nbsp;→</a></div>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text: lines.join("\n"), html };
}

type SendOptions = { fetchImpl?: typeof fetch; environment?: NodeJS.ProcessEnv; now?: Date };

/**
 * Revisa el consumo informado por el gateway y, si llegó al tope, avisa al personal de la
 * plataforma. Devuelve null si no corresponde avisar. La marca se reserva antes de enviar para
 * que dos heartbeats simultáneos no dupliquen el correo; si el envío falla se libera y el
 * siguiente heartbeat (15 min) reintenta.
 */
export async function checkGatewayDataAlert(db: Cam5Database, gatewayId: string, options: SendOptions = {}) {
  const [gateway] = await db.select({ code: gateways.code, name: gateways.name, metadata: gateways.metadata, siteName: sites.name })
    .from(gateways).innerJoin(sites, eq(sites.id, gateways.siteId))
    .where(eq(gateways.id, gatewayId)).limit(1);
  if (!gateway) return null;
  const health = gateway.metadata?.health as Record<string, unknown> | undefined;
  const month = typeof health?.lteMonth === "string" && /^\d{4}-\d{2}$/.test(health.lteMonth) ? health.lteMonth : null;
  const usedMb = typeof health?.lteMonthMb === "number" && Number.isFinite(health.lteMonthMb) ? health.lteMonthMb : null;
  if (!month || usedMb === null) return null;
  const plan = readDataPlan(gateway.metadata);
  if (usedMb < plan.alertMb) return null;
  const previous = readDataAlert(gateway.metadata);
  if (previous && previous.month === month && previous.alertMb === plan.alertMb) return null;

  const now = options.now ?? new Date();
  const recipients = await db.select({ email: users.email }).from(users)
    .where(and(eq(users.platformStaff, true), eq(users.status, "active")));
  const state: DataAlertState = { month, alertMb: plan.alertMb, usedMb, sentAt: now.toISOString(), recipients: recipients.length };
  const claimed = await db.update(gateways)
    .set({ metadata: sql`coalesce(${gateways.metadata}, '{}'::jsonb) || ${JSON.stringify({ dataAlert: state })}::jsonb` })
    .where(and(
      eq(gateways.id, gatewayId),
      sql`not (coalesce(${gateways.metadata}->'dataAlert', '{}'::jsonb) @> ${JSON.stringify({ month, alertMb: plan.alertMb })}::jsonb)`,
    ))
    .returning({ id: gateways.id });
  if (!claimed.length) return null;

  const release = () => db.update(gateways)
    .set({ metadata: previous ? sql`${gateways.metadata} || ${JSON.stringify({ dataAlert: previous })}::jsonb` : sql`${gateways.metadata} - 'dataAlert'` })
    .where(eq(gateways.id, gatewayId));
  try {
    const environment = options.environment ?? process.env;
    const apiKey = environment.RESEND_API_KEY?.trim();
    const from = environment.NOTIFICATION_FROM_EMAIL?.trim() || environment.AUTH_FROM_EMAIL?.trim();
    if (!recipients.length) throw new Error("No hay personal de la plataforma activo para recibir el aviso.");
    if (!apiKey || !from) throw new Error("El correo de avisos no está configurado.");
    const message = dataAlertEmail({ gatewayCode: gateway.code, gatewayName: gateway.name, siteName: gateway.siteName, month, usedMb, plan, portalUrl: `${appBaseUrl()}/?view=provisioning` });
    const response = await (options.fetchImpl ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: recipients.map((recipient) => recipient.email), subject: message.subject, text: message.text, html: message.html }),
    });
    if (!response.ok) throw new Error(`El proveedor de correo respondió ${response.status}.`);
    return state;
  } catch (error) {
    await release();
    throw error;
  }
}
