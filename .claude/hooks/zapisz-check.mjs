// PostToolUse (Bash | PowerShell): zapamiętuje czas ostatniego udanego `pnpm check`. Czyta go
// kontrola-konca.mjs, żeby przypomnieć o checku tylko wtedy, gdy kod zmienił się od tamtej pory.
// Sukces poznajemy po podsumowaniu Turbo („Tasks: N successful, N total”), nie po samym poleceniu.
import { readInput } from "./lib.mjs";
import { saveCheck } from "./stan.mjs";

const input = readInput();
const command = String(input.tool_input?.command ?? "");
if (/pnpm\s+(run\s+)?check\b/.test(command)) {
  const response = input.tool_response ?? {};
  const output =
    typeof response === "string" ? response : `${response.stdout ?? ""}${response.output ?? ""}`;
  const summary = output.match(/Tasks:\s+(\d+)\s+successful,\s+(\d+)\s+total/);
  if (summary && summary[1] === summary[2]) saveCheck();
}
