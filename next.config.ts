import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

// El portal no carga recursos externos: las fuentes se sirven desde el propio dominio
// (next/font) y toda la API vive en /api/v1. Next.js necesita scripts y estilos en línea
// para hidratar; en desarrollo, además, eval para el recargado en caliente.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isProduction ? "" : " ws:"}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    // La API de los gateways no la abre un navegador: sin estas cabeceras cada respuesta pesa
    // ~450 B menos, y los gateways de terreno conversan por 4G con datos limitados.
    return [{ source: "/:path((?!api/v1/gateway/).*)", headers: securityHeaders }];
  },
};

export default nextConfig;
