import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseConfig } from "./config";

// Odświeża sesję Supabase przy każdym żądaniu (wywoływane z src/proxy.ts).
export async function updateSession(request: NextRequest) {
  const config = getSupabaseConfig();
  // Bez skonfigurowanego Supabase aplikacja działa dalej, tylko bez auth.
  if (!config) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Nie wstawiaj żadnego kodu między createServerClient a getClaims — to odświeża token.
  await supabase.auth.getClaims();

  return response;
}
