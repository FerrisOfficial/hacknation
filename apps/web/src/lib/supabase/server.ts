import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireSupabaseConfig } from "./config";

// Klient Supabase do Server Components, Server Actions i route handlerów.
// Twórz nowy przy każdym żądaniu — nie trzymaj go w zmiennej globalnej.
export async function createClient() {
  const { url, key } = requireSupabaseConfig();
  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component nie może ustawiać cookies — sesję odświeża src/proxy.ts.
        }
      },
    },
  });
}
