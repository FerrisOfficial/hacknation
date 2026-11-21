// Kolektory uruchamia maszyna (cron, skrypt), nie użytkownik w przeglądarce — więc zamiast sesji
// Supabase wspólny token z env: `Authorization: Bearer $COLLECTOR_TOKEN`. Bez tokenu w env
// endpoint jest wyłączony (bezpieczny domyślny stan, np. na produkcji Cloudflare).

export type CollectorAccess = "ok" | "disabled" | "unauthorized";

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

// Porównanie skrótów w stałym czasie (bez wczesnego wyjścia na pierwszym różnym znaku).
export async function collectorAccess(
  authorization: string | null,
  expectedToken: string | undefined,
): Promise<CollectorAccess> {
  if (!expectedToken) return "disabled";
  const token = authorization?.match(/^Bearer\s+(\S+)\s*$/i)?.[1] ?? "";
  const [given, expected] = await Promise.all([sha256(token), sha256(expectedToken)]);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= (given[i] ?? 0) ^ (expected[i] ?? 0);
  return diff === 0 && token !== "" ? "ok" : "unauthorized";
}
