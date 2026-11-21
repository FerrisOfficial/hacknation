import "server-only";
import { NextResponse } from "next/server";
import { type ZodType, z } from "zod";
import { collectorAccess } from "@/lib/collect/auth";

// Wspólne kawałki route handlerów: walidacja wejścia Zodem, jednolite błędy `{ error }`,
// łapanie nieoczekiwanych wyjątków (log na serwerze, bez szczegółów dla klienta).

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

export async function readBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, z.prettifyError(parsed.error));
  return parsed.data;
}

export function readQuery<T>(request: Request, schema: ZodType<T>): T {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = schema.safeParse(params);
  if (!parsed.success) throw new HttpError(400, z.prettifyError(parsed.error));
  return parsed.data;
}

export function readId(id: string): string {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) throw new HttpError(404, "Nie znaleziono");
  return parsed.data;
}

// Endpointy dla maszyn (cron, skrypty, serwis ML): `Authorization: Bearer $COLLECTOR_TOKEN`.
export async function requireCollectorToken(request: Request): Promise<void> {
  const access = await collectorAccess(
    request.headers.get("authorization"),
    process.env.COLLECTOR_TOKEN,
  );
  if (access === "disabled") {
    throw new HttpError(503, "Endpoint wyłączony — ustaw COLLECTOR_TOKEN w env aplikacji");
  }
  if (access === "unauthorized") throw new HttpError(401, "Zły albo brak tokenu kolektora");
}

// Kod błędu Postgresa (np. 23505 = naruszenie unikalności) z błędu drizzle/postgres.js.
export function pgErrorCode(error: unknown): string | undefined {
  for (let current: unknown = error; current; ) {
    if (typeof current !== "object") return undefined;
    if ("code" in current && typeof current.code === "string" && /^[0-9A-Z]{5}$/.test(current.code))
      return current.code;
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

type Handler<C> = (request: Request, context: C) => Promise<Response>;

export function handler<C>(name: string, fn: Handler<C>): Handler<C> {
  return async (request, context) => {
    try {
      return await fn(request, context);
    } catch (error) {
      if (error instanceof HttpError) return jsonError(error.status, error.message, error.extra);
      console.error(`[api/${name}]`, error);
      return jsonError(500, "Wewnętrzny błąd serwera");
    }
  };
}
