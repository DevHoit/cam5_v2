import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CAM5 CORE | Gestión de Activos Críticos",
  description:
    "Telemetría predictiva para temperatura, descarga parcial y humedad en activos eléctricos críticos.",
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
