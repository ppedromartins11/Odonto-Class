import type { NextConfig } from "next";

// Configuracao minima para a Sprint 0.
// Nenhuma opcao especifica de funcionalidade foi adicionada ainda -
// isso sera revisado quando modulos concretos (upload de arquivos,
// geracao de PDF, etc.) forem implementados nas proximas sprints.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
