// Sprawdza połączenie z bazą z DATABASE_URL i tłumaczy typowe błędy Supabase.
// drizzle-kit przy nieudanym połączeniu kończy się bez treści błędu, dlatego `pnpm db:migrate`
// i workflow „Deploy bazy (Supabase)” uruchamiają ten skrypt przed migracjami.
// Node uruchamia ten plik bezpośrednio (type stripping), bez kompilacji.
import { existsSync } from "node:fs";
import postgres from "postgres";

// Tak samo jak drizzle.config.ts — sprawdzamy dokładnie ten adres, którego użyje drizzle-kit.
if (existsSync(".env")) process.loadEnvFile(".env");

const inCi = process.env.GITHUB_ACTIONS === "true";

function report(message: string): void {
  console.error(inCi ? `::error::${message}` : `BŁĄD: ${message}`);
}

function warn(message: string): void {
  console.warn(inCi ? `::warning::${message}` : `UWAGA: ${message}`);
}

function fail(message: string): never {
  report(message);
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

function hintFor(code: string, message: string): string {
  if (code === "28P01") {
    return "Złe hasło. Sprawdź, czy w adresie nie zostały nawiasy z [YOUR-PASSWORD] i czy znaki specjalne są zakodowane (np. @ → %40). Hasło zresetujesz w Supabase: Project Settings → Database.";
  }
  // Supavisor (pooler Supabase) zgłasza nieznany projekt jako XX000 „tenant/user … not found”.
  if (/tenant.*not found/i.test(message)) {
    return "Supabase nie zna tego projektu. Użytkownik musi mieć postać postgres.<id projektu>, host musi pasować do regionu projektu, a projekt nie może być wstrzymany (darmowy plan pauzuje po tygodniu bez ruchu).";
  }
  if (code === "3D000") {
    return "Nie ma takiej bazy. Adres powinien kończyć się na /postgres.";
  }
  if (code === "ENOTFOUND") {
    return "Nie znaleziono hosta. Skopiuj go z Supabase → Connect — region musi się zgadzać z projektem (np. aws-1-eu-central-1.pooler.supabase.com).";
  }
  if (["ENETUNREACH", "EHOSTUNREACH", "EAFNOSUPPORT"].includes(code)) {
    return "Brak trasy do serwera — najpewniej to „Direct connection”, która działa tylko po IPv6. Użyj Session poolera (port 5432).";
  }
  if (code === "ECONNREFUSED") {
    return "Serwer odrzucił połączenie. Sprawdź port: Session pooler to 5432.";
  }
  if (["CONNECT_TIMEOUT", "ETIMEDOUT"].includes(code)) {
    return "Przekroczony czas połączenia. Projekt może być wstrzymany (Supabase → Restore project) albo adres lub port jest zły.";
  }
  return "Porównaj adres z Supabase → Connect → Direct → URI (Session pooler).";
}

const raw = process.env.DATABASE_URL ?? "";
if (!raw) {
  fail(
    inCi
      ? "Brak DATABASE_URL (sekret w Settings → Environments → production)."
      : "Brak DATABASE_URL. Uruchom pnpm env:pull (pobiera dane dev z GitHuba) albo skopiuj packages/db/.env.example do packages/db/.env i uzupełnij.",
  );
}

let url: URL;
try {
  url = new URL(raw);
} catch {
  fail(
    "DATABASE_URL nie jest poprawnym adresem. Jeśli hasło ma znaki specjalne (@ # / ? :), zakoduj je, np. @ → %40.",
  );
}

const password = decodeURIComponent(url.password);
if (!password || password.includes("YOUR-PASSWORD")) {
  fail("W adresie nie ma hasła — wstaw je w miejsce [YOUR-PASSWORD].");
}
if (password.startsWith("[") && password.endsWith("]")) {
  fail(
    "Hasło jest w nawiasach [ ] z placeholdera [YOUR-PASSWORD]. Wstaw samo hasło, bez nawiasów.",
  );
}

const port = url.port || "5432";
if (url.hostname.startsWith("db.") && url.hostname.endsWith(".supabase.co")) {
  warn(
    "To adres „Direct connection” (tylko IPv6) — z GitHub Actions i wielu sieci się nie połączy. Użyj Session poolera.",
  );
}
if (port === "6543") {
  warn("Port 6543 to Transaction pooler. Do migracji używaj Session poolera (port 5432).");
}

console.log(`Łączę się z ${url.username}@${url.hostname}:${port}${url.pathname}…`);

const sql = postgres(raw, { max: 1, connect_timeout: 10, prepare: false, onnotice: () => {} });
try {
  const [row] = await sql<{ db: string; user: string }[]>`
    select current_database() as db, current_user as user`;
  console.log(`Połączenie OK (baza ${row?.db}, użytkownik ${row?.user}).`);
} catch (error) {
  const { code, message } = describe(error);
  report(`${code ? `[${code}] ` : ""}${message || "nieznany błąd"} — ${hintFor(code, message)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
