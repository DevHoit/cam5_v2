import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CAM5 CORE | Monitoreo de condición eléctrica",
  description:
    "Gestión multi-cliente de sitios, puntos de medición, gateways y telemetría CAM5.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
