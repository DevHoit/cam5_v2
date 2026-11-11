/**
 * URL pública del portal, usada en enlaces de correos y notificaciones.
 *
 * Prioridad: APP_URL explícita → dominio de producción que Vercel expone
 * (VERCEL_PROJECT_PRODUCTION_URL, que pasa a ser core.hoitlive.com al asignar el dominio) →
 * localhost para desarrollo.
 */
export function appBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercelProduction = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProduction) return `https://${vercelProduction.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}
