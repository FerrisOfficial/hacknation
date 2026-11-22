import type { ReviewStatus } from "@app/db";
import type {
  Evidence,
  Flag,
  IncidentDetail,
  IncidentDetails,
  IncidentListItem,
} from "@/lib/incidents/contract";

// Pola, których UI potrzebuje według mockupu, a których API jeszcze nie zwraca.
// Opis dla backendu: docs/KONTRAKT.md, sekcja „Zmiany dla UI (mockup hi-fi)”.
// Wszystkie są opcjonalne: ekrany działają na obecnym API i pokazują więcej, gdy pole przyjdzie.

// Status „Odłożony” (R6, R7): nowa wartość enumu `review_status`.
export type UiStatus = ReviewStatus | "postponed";

export const UI_STATUSES = ["new", "in_review", "postponed", "confirmed", "dismissed"] as const;

// Autor decyzji (R16). Bez logowania backend może zwracać stałego użytkownika z env.
export type Reviewer = { id: string; name: string; role: string | null };

export type Review = {
  status: UiStatus;
  reviewed_by?: Reviewer | null;
  reviewed_at?: string | null;
  // Powód przy „Odłożony” i „Fałszywy alarm” (np. „dowód niepełny”).
  review_note?: string | null;
};

export type UiListItem = Omit<IncidentListItem, "status"> &
  Review & {
    // Tytuł materiału (materials.title) i rejestr KNF w liście: nagłówek grupy i tytuł wiersza.
    title?: string | null;
    in_register?: boolean | null;
  };

export type UiList = { items: UiListItem[]; total: number };

// Dowód z klatki filmu (docs/KONTRAKT.md §3, KLATKI.md): obraz z ramką `box` (ułamki 0–1).
export type FrameEvidence = { file: string; box: [number, number, number, number]; ts?: number };
export type UiEvidence = Omit<Evidence, "start" | "end"> & {
  start: number | null;
  end: number | null;
  frame?: FrameEvidence | null;
};
export type UiFlag = Omit<Flag, "evidence"> & { evidence: UiEvidence | null };

export type HistoryEntry = {
  at: string;
  // null = system (oflagowanie, ponowna analiza, alert).
  actor: Reviewer | null;
  // Opis zdarzenia, np. „oflagowano 0,84 przy progu 0,55”, „Potwierdzony”, „otwarto”.
  action: string;
  status?: UiStatus | null;
};

export type UiDetail = Omit<IncidentDetail, "status" | "details" | "material"> &
  Review & {
    material: IncidentDetail["material"] & {
      // Pobrany film YouTube (GET /api/incidents/:id/video, video/mp4 z obsługą Range).
      has_video?: boolean;
      duration_s?: number | null;
      // Skrót SHA-256 kopii (dowód niezmienności, R4).
      content_hash?: string | null;
    };
    details: Omit<IncidentDetails, "flags"> & { flags: UiFlag[] };
    history?: HistoryEntry[];
  };

// GET /api/me: kto pracuje w tej przeglądarce (awatar w nawigacji, autor decyzji).
export type Me = Reviewer;
