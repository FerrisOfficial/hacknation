// Włącza git hooki z .githooks/ (core.hooksPath). Uruchamia się samo po `pnpm install`.
// Pomija CI i katalogi bez repozytorium gita (np. budowanie obrazu Dockera).
import { git } from "./common.mjs";

if (!process.env.CI && git("rev-parse", "--is-inside-work-tree") === "true") {
  if (git("config", "core.hooksPath") !== ".githooks") {
    git("config", "core.hooksPath", ".githooks");
    console.log("Włączono git hooki z .githooks (pre-commit, pre-push)");
  }
}
