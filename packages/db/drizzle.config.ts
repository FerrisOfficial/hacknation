import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  // Nie dotykamy schematów Supabase (auth, storage…), tylko naszego `public`.
  schemaFilter: ["public"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
