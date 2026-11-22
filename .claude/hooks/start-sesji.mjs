// SessionStart: na początku każdej sesji agent dostaje krótki stan repo, zamiast odkrywać go
// kolejnymi poleceniami. To, co hook wypisze na stdout, trafia do kontekstu agenta.
import { git } from "./lib.mjs";

const branch = git("branch", "--show-current") || "(odłączony HEAD)";
const dirty = git("status", "--porcelain").split("\n").filter(Boolean).length;
const behind = Number(git("rev-list", "--count", "HEAD..origin/main")) || 0;

const lines = [
  `Stan repo: gałąź ${branch}, ${dirty} zmienionych plików, ${behind} commitów za origin/main.`,
];
if (branch === "main") {
  lines.push(
    "Jesteś na main (chroniony). Przed zmianami: `git switch -c feat/<opis>` albo `fix/<opis>`.",
  );
}
if (behind > 0)
  lines.push("Gałąź jest za origin/main — rozważ `git pull --rebase origin main` przed pracą.");
lines.push(
  "Źródła prawdy: docs/ZADANIE.md (wymagania UKNF), docs/KONTRAKT.md (API UI ↔ backend ↔ AI), docs/PROCES-AI.md (jak pracujemy z agentami).",
  "Procedury krok po kroku są w .claude/skills — użyj pasującego skilla, zamiast odtwarzać kroki z pamięci.",
);

const deadline = new Date("2026-11-22T11:00:00+01:00");
const minutes = Math.round((deadline.getTime() - Date.now()) / 60_000);
if (minutes > 0 && minutes < 48 * 60) {
  lines.push(
    `Do oddania na HackNation: ${Math.floor(minutes / 60)} h ${minutes % 60} min. Priorytet: działające demo, nie refaktor.`,
  );
}

process.stdout.write(`${lines.join("\n")}\n`);
