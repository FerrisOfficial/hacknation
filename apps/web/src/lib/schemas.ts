import { z } from "zod";

// Schematy Zod współdzielone przez formularze (klient) i route handlery (serwer).
export const predictInputSchema = z.object({
  text: z.string().trim().min(3, "Wpisz co najmniej 3 znaki").max(2000, "Maksymalnie 2000 znaków"),
});

export type PredictInput = z.infer<typeof predictInputSchema>;

// POST /api/collect/youtube — uruchomienie kolektora YouTube z zapisem do bazy.
export const youtubeCollectInputSchema = z.object({
  query: z.string().trim().min(2, "Fraza musi mieć co najmniej 2 znaki").max(200),
  limit: z.number().int().min(1).max(50).default(10),
  // Tylko filmy z etykietą „Zawiera płatną promocję”.
  paidOnly: z.boolean().default(true),
});

export type YoutubeCollectInput = z.infer<typeof youtubeCollectInputSchema>;
