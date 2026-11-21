import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

// Baza treści: surowy HTML materiałów jako obiekty adresowane treścią (SHA-256), skompresowane gzip,
// na lokalnym dysku (wolumen `content-store` w compose.yaml). W bazie SQL zostaje tylko odnośnik
// `materials.content_ref = "sha256:<hex>"`, więc tabela nie puchnie od HTML-a, a ta sama strona
// zebrana dwa razy zajmuje miejsce raz. Podmiana na S3/MinIO = nowa implementacja tych dwóch funkcji.

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const REF_PREFIX = "sha256:";

function storeDir(): string {
  // Katalog z env w runtime — Turbopack nie ma go śledzić przy buildzie (inaczej bierze cały projekt).
  return path.resolve(/*turbopackIgnore: true*/ process.env.CONTENT_STORE_DIR ?? ".data/content");
}

function objectPath(hex: string): string {
  // Dwa poziomy katalogów, żeby nie trzymać setek tysięcy plików w jednym.
  return path.join(storeDir(), hex.slice(0, 2), `${hex}.html.gz`);
}

export async function putContent(html: string): Promise<string> {
  const hex = createHash("sha256").update(html, "utf8").digest("hex");
  const file = objectPath(hex);
  await mkdir(path.dirname(file), { recursive: true });
  // Zapis do pliku tymczasowego i rename — czytelnik nigdy nie zobaczy połowy obiektu.
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, await gzipAsync(html));
  await rename(tmp, file);
  return `${REF_PREFIX}${hex}`;
}

export async function getContent(ref: string): Promise<string | null> {
  const hex = ref.startsWith(REF_PREFIX) ? ref.slice(REF_PREFIX.length) : "";
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  try {
    return (await gunzipAsync(await readFile(objectPath(hex)))).toString("utf8");
  } catch {
    return null;
  }
}
