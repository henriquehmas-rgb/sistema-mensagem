import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@sm/shared"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
  eslint: {
    ignoreDuringBuilds: true,
  },
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Widget do webchat: ÚNICA rota embutível em iframe de terceiros —
        // frame-ancestors * explícito (é o propósito da página).
        source: "/webchat/widget",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
      {
        // Todas as demais rotas (inbox, kanban, settings, login, assets):
        // nunca dentro de iframe — anti clickjacking/UI-redressing sobre a
        // sessão do agente.
        source: "/((?!webchat/widget).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
