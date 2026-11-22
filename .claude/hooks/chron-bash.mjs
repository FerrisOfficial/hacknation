// PreToolUse (Bash | PowerShell): polecenia, które łamią zasady zespołu albo niszczą dane do demo.
// Agent dostaje powód i bezpieczną alternatywę. Człowiek może je uruchomić sam w terminalu.
import { block, git, readInput } from "./lib.mjs";

const input = readInput();
const branch = git("branch", "--show-current");

// Sprawdzamy polecenia, a nie tekst: treść heredoców i argumentów -m/--body/--title (opis commita
// albo PR-a, który może wspominać „drizzle-kit push”) wycinamy przed dopasowaniem reguł.
const command = String(input.tool_input?.command ?? "")
  .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g, "<<heredoc")
  .replace(/@'[\s\S]*?'@|@"[\s\S]*?"@/g, "here-string")
  .replace(/(\s(?:-m|--message|--body|--title|-t|-b))\s+("(?:[^"\\]|\\.)*"|'[^']*')/g, "$1 tekst");

const RULES = [
  {
    test: /drizzle-kit\s+push|\bdb:push\b/,
    why: "Schemat zmieniamy tylko migracją — `drizzle-kit push` pomija ją i inni nie dostaną zmiany.",
    fix: "`pnpm db:generate`, commit migracji, `pnpm db:migrate`.",
  },
  {
    test: /docker\s+compose\b[^\n]*\bdown\b[^\n]*(\s-v\b|--volumes)/,
    why: "`docker compose down -v` kasuje wolumeny: bazę z zebranymi materiałami, klatki filmów i model.",
    fix: "`docker compose down` (bez -v) albo restart jednej usługi. Czyszczenie danych zostaw człowiekowi.",
  },
  {
    test: /--no-verify\b|git\s+commit\b[^\n]*\s-n\b/,
    why: "Git hooki (.githooks) to bramka jakości — agent ich nie omija.",
    fix: "Napraw błąd zgłoszony przez hook i powtórz commit/push.",
  },
  {
    test: /git\s+push\b[^\n]*(--force(?!-with-lease)|\s-f\b)/,
    why: "Force push nadpisuje cudzą pracę na wspólnej gałęzi.",
    fix: "`git push --force-with-lease` na własnej gałęzi albo nowy commit.",
  },
  {
    test: /git\s+push\b[^\n]*[\s:](refs\/heads\/)?main(?=\s|$|[;&|])/,
    why: "`main` jest chroniony — zmiany tylko przez PR z zielonym CI.",
    fix: "Wypchnij gałąź `feat/…` lub `fix/…` i otwórz PR (skill: przed-pr).",
  },
  {
    test: /git\s+commit\b/,
    when: () => branch === "main",
    why: "Jesteś na `main` — commity idą na gałąź funkcji.",
    fix: "`git switch -c feat/<krótki-opis>` i commit tam.",
  },
  {
    test: /(^|[;&|]\s*)(npm|yarn)\s+(i|install|add)\b|(^|[;&|]\s*)npx\s/,
    why: "Repo używa pnpm (lockfile pnpm-lock.yaml).",
    fix: "`pnpm add <pakiet> --filter <pakiet-repo>` albo `pnpm dlx <narzędzie>`.",
  },
  {
    test: /(^|[;&|]\s*)(pip3?|python\s+-m\s+pip|uv\s+pip)\s+install\b/,
    why: "Zależności Pythona trzymamy w pyproject.toml i uv.lock.",
    fix: "`uv add <pakiet>` w services/ml albo services/media.",
  },
];

for (const rule of RULES) {
  if (rule.test.test(command) && (rule.when?.() ?? true)) {
    block(`Zablokowano: ${command.slice(0, 120)}\nPowód: ${rule.why}\nZamiast tego: ${rule.fix}`);
  }
}
