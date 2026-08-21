import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { CLINIC_NAME } from "@/lib/config/clinic";

// Inter via next/font: mesma fonte do prototipo (theme.css apontava para
// o Google Fonts via CDN), mas auto-hospedada pelo Next - evita chamada
// de rede externa em runtime e elimina flash de fonte não estilizada.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: `${CLINIC_NAME} - Sistema de Gestão`,
  description: "Sistema de gestão para clínica odontológica.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
