import { z } from "zod";

// Schematy Zod współdzielone przez formularze (klient) i route handlery (serwer).
export const predictInputSchema = z.object({
  text: z.string().trim().min(3, "Wpisz co najmniej 3 znaki").max(2000, "Maksymalnie 2000 znaków"),
});

export type PredictInput = z.infer<typeof predictInputSchema>;
