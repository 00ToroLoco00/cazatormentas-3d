import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cazatormentas 3D — Simulación atmosférica",
  description:
    "Un mundo meteorológico 3D inspirado en las pampas de Uruguay, con tormentas y tornados que evolucionan naturalmente.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
