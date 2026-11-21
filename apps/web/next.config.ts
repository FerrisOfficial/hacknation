import path from "node:path";
import type { NextConfig } from "next";
import { basePath } from "./src/lib/base-path";

const nextConfig: NextConfig = {
  // Aplikacja pod http://localhost:3000/hacknation.
  basePath,
  // Obraz Dockera (apps/web/Dockerfile) uruchamia samodzielny serwer z .next/standalone.
  // Root śledzenia plików = root monorepo, bo aplikacja importuje pakiety z packages/*.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // http://localhost:3000/ przenosi na /hacknation.
  async redirects() {
    return [{ source: "/", destination: basePath, basePath: false, permanent: false }];
  },
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
