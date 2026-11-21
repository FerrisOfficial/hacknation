// Wywoływane raz przy starcie serwera Next.js (`next dev`, `next start`, obraz Dockera).
// Uruchamia worker kolejki, harmonogram i serwer Socket.io (@/lib/background).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBackground } = await import("@/lib/background");
  startBackground();
}
