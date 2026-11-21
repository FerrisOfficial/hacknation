import path from "node:path";
import type { NextConfig } from "next";
import { basePath } from "./src/lib/base-path";

const nextConfig: NextConfig = {
  // Produkcja: https://maciejstempniak.com/hacknation — reszta domeny to inna strona.
  basePath,
  // Obraz Dockera (apps/web/Dockerfile) uruchamia samodzielny serwer z .next/standalone.
  // Root śledzenia plików = root monorepo, bo aplikacja importuje pakiety z packages/*.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Lokalnie http://localhost:3000/ przenosi na /hacknation (na produkcji "/" domeny nie trafia do aplikacji).
  async redirects() {
    return [{ source: "/", destination: basePath, basePath: false, permanent: false }];
  },
  // Bez cacheComponents (i zależnego od nich partialPrefetching): na Cloudflare Workers
  // renderowanie z Cache Components zawiesza żądanie (błąd 1101).
  // Poprawka w OpenNext: https://github.com/opennextjs/opennextjs-cloudflare/pull/1318
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
