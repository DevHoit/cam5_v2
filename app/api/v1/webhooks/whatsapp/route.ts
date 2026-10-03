import type { NextRequest } from "next/server";
import { getDb } from "../../../../db/index";
import { processMetaWhatsAppWebhook, verifyMetaWebhookSignature } from "../../../../db/whatsapp-webhook";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  const expected = process.env.META_WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  const appSecret = process.env.META_WHATSAPP_APP_SECRET;
  if (!appSecret) return Response.json({ error: "Webhook Meta no configurado." }, { status: 503 });

  const rawBody = await request.text();
  if (!verifyMetaWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    return Response.json({ error: "Firma Meta no válida." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "JSON no válido." }, { status: 400 });
  }

  try {
    const result = await processMetaWhatsAppWebhook(getDb(), body as Parameters<typeof processMetaWhatsAppWebhook>[1]);
    return Response.json({ ok: true, ...result }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("WhatsApp webhook processing error", error);
    return Response.json({ error: "No fue posible procesar el webhook." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
