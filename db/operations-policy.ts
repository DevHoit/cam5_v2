type Environment = Record<string, string | undefined>;

export function operationsPolicy(environment: Environment) {
  if (environment.VERCEL_ENV && environment.VERCEL_ENV !== "production") {
    const secret = environment.HOIT_PREVIEW_OPERATIONS_TOKEN;
    const siteCode = environment.HOIT_PREVIEW_OPERATIONS_SITE_CODE?.trim();
    if (!secret || !siteCode) throw new Error("El scheduler de Preview requiere token propio y sitio de pruebas explícito.");
    return { secret, siteCode, mode: "evaluate_only" as const };
  }
  if (!environment.CRON_SECRET) throw new Error("CRON_SECRET no está configurado.");
  return { secret: environment.CRON_SECRET, siteCode: null, mode: "dispatch" as const };
}
