import { PASSWORD_RESET_MINUTES } from "./auth";

type PasswordResetEmail = {
  to: string;
  displayName: string;
  resetUrl: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function passwordResetEmailHtml(input: PasswordResetEmail) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light only">
  <title>Restablece tu contraseña de HoitLive Core</title>
  <style>@media only screen and (max-width:620px){.email-shell{width:100%!important}.email-pad{padding-left:22px!important;padding-right:22px!important}.cta{display:block!important;text-align:center!important}}</style>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;color:#18181b;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Enlace seguro para recuperar tu acceso a HoitLive Core.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f5f7;"><tr><td align="center" style="padding:32px 14px;">
    <table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(24,24,27,.07);">
      <tr><td class="email-pad" style="padding:22px 30px;background:#0a0b0d;border-bottom:3px solid #0284c7;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="48"><div style="width:40px;height:40px;line-height:40px;text-align:center;border-radius:10px;background:#17191c;border:1px solid #34373d;color:#7dd3fc;font-size:13px;font-weight:800;">HL</div></td><td style="padding-left:12px;"><div style="color:#fafafa;font-size:19px;font-weight:800;letter-spacing:-.03em;">HoitLive <span style="color:#8b8d94;font-weight:500;">Core</span></div><div style="margin-top:3px;color:#71717a;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Seguridad de la cuenta</div></td></tr></table>
      </td></tr>
      <tr><td class="email-pad" style="padding:32px 30px 28px;">
        <span style="display:inline-block;padding:7px 11px;border-radius:999px;background:#f0f9ff;color:#075985;font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;">Solicitud de recuperación</span>
        <h1 style="margin:18px 0 10px;color:#18181b;font-size:27px;line-height:1.2;font-weight:800;letter-spacing:-.035em;">Restablece tu contraseña</h1>
        <p style="margin:0;color:#52525b;font-size:15px;line-height:1.65;">Hola ${escapeHtml(input.displayName)}, recibimos una solicitud para recuperar tu acceso a HoitLive Core.</p>
        <div style="padding-top:24px;"><a class="cta" href="${escapeHtml(input.resetUrl)}" style="display:inline-block;padding:13px 19px;border-radius:9px;background:#0284c7;color:#ffffff;text-decoration:none;font-size:14px;font-weight:750;">Crear una nueva contraseña&nbsp;&nbsp;→</a></div>
        <div style="margin-top:24px;padding:14px 16px;border-left:3px solid #0284c7;background:#fafafa;color:#52525b;font-size:13px;line-height:1.6;"><strong style="color:#27272a;">Enlace de un solo uso.</strong> Caduca en ${PASSWORD_RESET_MINUTES} minutos y quedará invalidado después de cambiar la contraseña.</div>
        <p style="margin:22px 0 0;color:#71717a;font-size:13px;line-height:1.6;">Si no solicitaste este cambio, puedes ignorar el correo. Tu contraseña actual seguirá funcionando.</p>
      </td></tr>
      <tr><td class="email-pad" style="padding:18px 30px;background:#fafafa;border-top:1px solid #e4e4e7;color:#71717a;font-size:12px;line-height:1.55;">HoitLive Core nunca solicitará tu contraseña por correo electrónico.</td></tr>
    </table>
    <div style="padding:16px 10px 0;color:#a1a1aa;font-size:11px;line-height:1.5;">HoitLive Core · Supervisión de activos críticos</div>
  </td></tr></table>
</body>
</html>`;
}

export async function sendPasswordResetEmail(
  input: PasswordResetEmail,
  options: { fetchImpl?: typeof fetch; environment?: NodeJS.ProcessEnv } = {},
) {
  const environment = options.environment ?? process.env;
  const apiKey = environment.RESEND_API_KEY?.trim();
  const from = environment.AUTH_FROM_EMAIL?.trim() || environment.NOTIFICATION_FROM_EMAIL?.trim();
  if (!apiKey || !from) throw new Error("El correo de recuperación no está configurado.");
  const text = [
    `Hola ${input.displayName},`,
    "",
    "Recibimos una solicitud para restablecer tu contraseña de HoitLive Core.",
    `Abre este enlace dentro de los próximos ${PASSWORD_RESET_MINUTES} minutos:`,
    input.resetUrl,
    "",
    "Si no solicitaste el cambio, ignora este mensaje.",
  ].join("\n");
  const response = await (options.fetchImpl ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: "Restablece tu contraseña · HoitLive Core",
      text,
      html: passwordResetEmailHtml(input),
    }),
  });
  const result = await response.json().catch(() => ({})) as { id?: string; message?: string };
  if (!response.ok) throw new Error(result.message || `El proveedor de correo respondió ${response.status}.`);
  return { providerMessageId: result.id ?? null };
}
