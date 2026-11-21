// Sprawdza połączenie z bazą z DATABASE_URL (lokalny Postgres z compose.yaml) i tłumaczy typowe
// błędy. drizzle-kit przy nieudanym połączeniu kończy się bez treści błędu, dlatego `pnpm db:migrate`
// uruchamia ten skrypt przed migracjami.
// Node uruchamia ten plik bezpośrednio (type stripping), bez kompilacji.
import { existsSync } from "node:fs";
import postgres from "postgres";

// Tak samo jak drizzle.config.ts — sprawdzamy dokładnie ten adres, którego użyje drizzle-kit.
if (existsSync(".env")) process.loadEnvFile(".env");

function fail(message: string): never {
  console.error(`BŁĄD: ${message}`);
  process.exit(1);
}

function redact(text: string): string {
  return text.replace(/(postgres(?:ql)?:\/\/[^:/]+:)[^@]+@/g, "$1***@");
}

function describe(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? error.code : "";
    return { code, message: redact(error.message) };
  }
  return { code: "", message: redact(String(error)) };
}

function hintFor(code: string): string {
  if (code === "ECONNREFUSED") {
    return "Baza nie działa. Uruchom ją: pnpm db:up (wymaga Dockera).";
  }
  if (code === "28P01") {
    return "Złe hasło. Hasło w DATABASE_URL musi być takie jak POSTGRES_PASSWORD w .env w roocie. Baza zapamiętuje hasło z pierwszego startu — po zmianie wyczyść ją: docker compose down -v.";
  }
  if (code === "3D000") {
    return "Nie ma takiej bazy. Adres powinien kończyć się na /hacknation.";
  }
  if (["CONNECT_TIMEOUT", "ETIMEDOUT"].includes(code)) {
    return "Przekroczony czas połączenia. Sprawdź, czy kontener db działa: docker compose ps.";
  }
  return "Porównaj DATABASE_URL z packages/db/.env.example.";
}

const raw = process.env.DATABASE_URL ?? "";
if (!raw) {
  fail("Brak DATABASE_URL. Uruchom pnpm env:init (tworzy packages/db/.env z .env.example).");
}

let url: URL;
try {
  url = new URL(raw);
} catch {
  fail(
    "DATABASE_URL nie jest poprawnym adresem. Jeśli hasło ma znaki specjalne (@ # / ? :), zakoduj je, np. @ → %40.",
  );
}

console.log(`Łączę się z ${url.username}@${url.hostname}:${url.port || "5432"}${url.pathname}…`);

const sql = postgres(raw, { max: 1, connect_timeout: 10, onnotice: () => {} });
try {
  const [row] = await sql<{ db: string; user: string }[]>`
    select current_database() as db, current_user as user`;
  console.log(`Połączenie OK (baza ${row?.db}, użytkownik ${row?.user}).`);
} catch (error) {
  const { code, message } = describe(error);
  console.error(
    `BŁĄD: ${code ? `[${code}] ` : ""}${message || "nieznany błąd"} — ${hintFor(code)}`,
  );
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
