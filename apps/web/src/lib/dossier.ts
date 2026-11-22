import { strToU8, type Zippable, zipSync } from "fflate";
import { MODULE_LABELS, STATUS_LABELS } from "@/lib/analysis/modules";
import type { IncidentDetail, IncidentDetails, Reviewer } from "@/lib/incidents/contract";
import { formatScore } from "@/lib/incidents/history";

// Teczka podmiotu (Z7, GET /api/entities/dossier): potwierdzone materiały jednej firmy w ZIP.
// Na materiał jeden katalog: kopia strony z dnia scrapingu, tekst, a w material.json wyniki
// modułów z `details` (dowody) i historią decyzji. Na górze spis.txt dla człowieka i teczka.json.

// Ten sam podmiot co w Kolejce i Widoku podmiotu: firma z rejestru KNF, a bez niej reklamodawca.
export function entityNameOf(details: IncidentDetails): string | null {
  return details.entity.firm_name ?? details.entity.advertiser ?? null;
}

export type DossierCase = {
  // Incydenty jednego materiału (po jednym na moduł), wszystkie potwierdzone.
  incidents: IncidentDetail[];
  // Surowy HTML z dnia scrapingu albo null, gdy materiał nie ma kopii (np. film).
  snapshot: string | null;
};

export type Dossier = {
  firm: string;
  generatedAt: Date;
  generatedBy: Reviewer;
  cases: DossierCase[];
};

function slug(value: string, max = 40): string {
  const text = value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return text || "material";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function dossierFileName(firm: string, generatedAt: Date): string {
  return `teczka-${slug(firm, 60)}-${generatedAt.toISOString().slice(0, 10)}.zip`;
}

function folderOf(index: number, material: IncidentDetail["material"]): string {
  return `${String(index + 1).padStart(2, "0")}-${slug(hostOf(material.url), 30)}`;
}

function who(reviewer: Reviewer | null): string {
  if (!reviewer) return "system";
  return reviewer.role ? `${reviewer.name} (${reviewer.role})` : reviewer.name;
}

function summaryText(dossier: Dossier, folders: string[]): string {
  const incidents = dossier.cases.reduce((sum, item) => sum + item.incidents.length, 0);
  const lines = [
    `Teczka podmiotu: ${dossier.firm}`,
    `Wygenerowano: ${dossier.generatedAt.toISOString()} przez ${who(dossier.generatedBy)}`,
    `Potwierdzone incydenty: ${incidents} w ${dossier.cases.length} materiałach`,
    "",
  ];
  dossier.cases.forEach((item, index) => {
    const [first] = item.incidents;
    if (!first) return;
    const { material } = first;
    lines.push(`${folders[index]}/  ${material.title ?? hostOf(material.url)}`);
    lines.push(`    ${material.url}`);
    lines.push(
      `    pobrano ${material.scraped_at}, SHA-256 kopii ${material.content_hash}${item.snapshot === null ? "" : ", kopia: kopia.html"}`,
    );
    for (const incident of item.incidents) {
      const decision = incident.reviewed_at
        ? `, ${STATUS_LABELS[incident.status].toLowerCase()} ${incident.reviewed_at} przez ${who(incident.reviewed_by)}`
        : "";
      lines.push(
        `    ${MODULE_LABELS[incident.module]}: score ${formatScore(incident.score)}${decision}`,
      );
      for (const flag of incident.details.flags.filter((flag) => flag.result === "violation")) {
        const quote = flag.evidence ? `: „${flag.evidence.quote}”` : "";
        lines.push(`      - ${flag.rule_name || flag.rule_id}${quote}`);
      }
    }
    lines.push("");
  });
  return `${lines.join("\n")}\n`;
}

export function buildDossier(dossier: Dossier): Uint8Array {
  const folders = dossier.cases.map((item, index) => {
    const [first] = item.incidents;
    return first ? folderOf(index, first.material) : String(index + 1).padStart(2, "0");
  });
  const files: Zippable = {
    "spis.txt": strToU8(summaryText(dossier, folders)),
    "teczka.json": strToU8(
      JSON.stringify(
        {
          firm: dossier.firm,
          generated_at: dossier.generatedAt.toISOString(),
          generated_by: dossier.generatedBy,
          materials: dossier.cases.map((item, index) => ({
            folder: folders[index],
            url: item.incidents[0]?.material.url ?? null,
            incidents: item.incidents.map((incident) => incident.id),
          })),
        },
        null,
        2,
      ),
    ),
  };
  dossier.cases.forEach((item, index) => {
    const [first] = item.incidents;
    if (!first) return;
    const { text, ...material } = first.material;
    const folder: Zippable = {
      "material.json": strToU8(
        JSON.stringify(
          {
            material,
            incidents: item.incidents.map(({ material: _material, ...incident }) => incident),
          },
          null,
          2,
        ),
      ),
      "tekst.txt": strToU8(text),
    };
    if (item.snapshot !== null) folder["kopia.html"] = strToU8(item.snapshot);
    files[folders[index] ?? String(index + 1)] = folder;
  });
  return zipSync(files, { level: 6, mtime: dossier.generatedAt });
}
