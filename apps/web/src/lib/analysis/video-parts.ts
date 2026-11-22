import type { Material } from "@app/db";
import { z } from "zod";
import type { AnalyzeVideo } from "./contract";

// Części filmu YouTube dla reguły 7 M2 (docs/KONTRAKT.md §1): tytuł, opis i transkrypcja osobno,
// bo `materials.text` skleja je w jeden tekst. Czysta funkcja na `materials.metadata` z kolektora.

const videoMetadataSchema = z.object({
  kind: z.literal("youtube_video"),
  description: z.string().nullish(),
  transcript: z
    .object({ segments: z.array(z.object({ text: z.string() })) })
    .nullish()
    .catch(null),
});

export function videoParts(material: Pick<Material, "title" | "metadata">): AnalyzeVideo | null {
  const parsed = videoMetadataSchema.safeParse(material.metadata);
  if (!parsed.success) return null;
  const segments = parsed.data.transcript?.segments ?? [];
  const transcript = segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ");
  return {
    title: material.title ?? "",
    description: parsed.data.description ?? "",
    transcript: transcript || null,
  };
}
