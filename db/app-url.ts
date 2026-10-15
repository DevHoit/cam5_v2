export function publicAppUrl(environment: NodeJS.ProcessEnv = process.env) {
  const configured = environment.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const vercelUrl = environment.VERCEL_URL?.trim();
  if (vercelUrl) {
    const host = vercelUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    return `https://${host}`;
  }

  return "https://core.hoitlive.com";
}
