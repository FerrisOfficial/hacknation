import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Przykładowa tabela — zmień albo usuń. Po każdej zmianie schematu: `pnpm db:generate`.
// Użytkownicy żyją w Supabase Auth (schemat `auth`), tutaj trzymamy tylko ich id.
//
// KAŻDA tabela musi mieć .enableRLS(). Supabase wystawia schemat `public` przez swoje REST API,
// a klucz publishable jest jawny (siedzi w przeglądarce). RLS bez polityk = REST API nie widzi
// tabeli, a nasz serwer (Drizzle, bezpośrednie połączenie) dalej ma pełny dostęp.
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("notes_user_id_idx").on(table.userId)],
).enableRLS();

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
