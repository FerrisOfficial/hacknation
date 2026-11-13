import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseConfig } from "./config";

// Klient Supabase do komponentów "use client".
export function createClient() {
  const { url, key } = requireSupabaseConfig();
  return createBrowserClient(url, key);
}
