import { createHash } from "node:crypto";

// Ten sam algorytm co `content_hash` w services/ml/src/ml/scraper.py: NFC, białe znaki zwinięte
// do spacji, małe litery, SHA-256. Dla materiałów wgranych przez API bez hasha z serwisu ML.
export function contentHash(text: string): string {
  const canonical = text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
