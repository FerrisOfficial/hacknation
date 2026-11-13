// Odwołania muszą być dosłowne (process.env.NEXT_PUBLIC_…), żeby Next wstrzyknął je do bundla klienta.
export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

export function requireSupabaseConfig() {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error(
      "Brak NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY w apps/web/.env.local",
    );
  }
  return config;
}
