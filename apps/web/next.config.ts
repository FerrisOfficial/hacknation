import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
