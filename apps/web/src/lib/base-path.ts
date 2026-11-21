// Aplikacja działa pod http://localhost:3000/hacknation (`pnpm dev` i Docker Compose).
// Next dokleja ten prefiks sam do <Link>, routera i plików z _next. Do fetch() na własne API
// i do src w next/image (pliki z public/) trzeba go dodać ręcznie — użyj withBasePath().
export const basePath = "/hacknation";

export function withBasePath(path: `/${string}`): string {
  return `${basePath}${path}`;
}
