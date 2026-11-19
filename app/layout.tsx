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
  title: "HoitLive Core | Monitoreo de condición eléctrica",
  description:
    "Plataforma de gestión de sitios, puntos de medición, gateways y telemetría CAM5.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Aplica el tema guardado antes de pintar, para no mostrar un destello claro en modo oscuro. */}
        <script dangerouslySetInnerHTML={{ __html: "try{var m=document.cookie.match(/(?:^|; )hoit-theme=(light|dark)/),t=m&&m[1];if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.dataset.theme='dark'}catch(e){}" }} />
      </head>
      <body className={`${inter.variable} ${plexMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
