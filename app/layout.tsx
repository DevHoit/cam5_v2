import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-plex-mono",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "HoitLive Core | Industrial IoT Platform",
  description:
    "Industrial IoT Platform para supervisión de activos, gateways, telemetría, alarmas y operación.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${inter.variable} ${plexMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
