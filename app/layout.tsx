import type { Metadata } from "next";
import "./globals.css";
import { CLINIC_NAME } from "@/lib/config/clinic";

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
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
