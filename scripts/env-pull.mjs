// Pobiera pliki .env bazy DEV ze zmiennych repo na GitHubie
// (Settings → Secrets and variables → Actions → Variables: DEV_WEB_ENV, DEV_DB_ENV).
// Zmienne repo może odczytać każdy współpracownik, więc nikt nie musi rozsyłać haseł:
// wystarczy raz `gh auth login`, a `pnpm install` sam utworzy brakujące pliki.
//
//   pnpm env:pull           tworzy brakujące pliki .env
//   pnpm env:pull --force   nadpisuje istniejące (gdy właściciel zmienił dane dev)
//
// Po `pnpm install` działa z --auto: w CI się pomija, a błąd nie przerywa instalacji.
// Wartości nigdy nie są wypisywane. Tylko DEV — produkcja jest wyłącznie w sekrecie
// środowiska `production`.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  { variable: "DEV_WEB_ENV", path: "apps/web/.env.local" },
  { variable: "DEV_DB_ENV", path: "packages/db/.env" },
];

const args = process.argv.slice(2);
const auto = args.includes("--auto");
const force = args.includes("--force");

if (auto && process.env.CI) process.exit(0);

const fallback =
  "Bez gh: skopiuj pliki .env.example (patrz README) i poproś właściciela repo o dane dev.";

function stop(message) {
  console.warn(`${auto ? "UWAGA" : "BŁĄD"}: ${message}`);
  // Po `pnpm install` tylko ostrzegamy — instalacja ma się udać także bez dostępu do zmiennych.
  process.exit(auto ? 0 : 1);
}

function readVariable(name) {
  try {
    return execFileSync("gh", ["variable", "get", name], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      stop(
        `Nie ma GitHub CLI (gh), więc nie pobiorę plików .env. Zainstaluj go (Windows: winget install GitHub.cli, macOS: brew install gh), uruchom gh auth login, potem pnpm env:pull. ${fallback}`,
      );
    }
    const details = String(error.stderr ?? "").trim();
    if (/auth login/i.test(details)) {
      stop("gh nie jest zalogowany. Uruchom gh auth login, potem pnpm env:pull.");
    }
    stop(
      `Nie udało się pobrać zmiennej ${name}: ${details.split("\n")[0] || "nieznany błąd"}. Sprawdź, czy masz dostęp do repo na GitHubie (zaakceptowane zaproszenie). ${fallback}`,
    );
  }
}

const todo = files.filter((file) => force || !existsSync(join(root, file.path)));
if (todo.length === 0) {
  if (!auto) console.log("Pliki .env już są. Żeby pobrać je od nowa: pnpm env:pull --force");
  process.exit(0);
}

for (const file of todo) {
  const value = readVariable(file.variable);
  if (!value.trim()) stop(`Zmienna ${file.variable} na GitHubie jest pusta.`);
  writeFileSync(join(root, file.path), value.endsWith("\n") ? value : `${value}\n`, {
    mode: 0o600,
  });
  console.log(`Zapisano ${file.path} (dane dev z GitHuba, zmienna ${file.variable}).`);
}
