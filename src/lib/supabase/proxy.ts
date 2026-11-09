import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicEnv } from "@/lib/env";

/**
 * Refreshes the Supabase auth session cookie on each request.
 * This is session maintenance only — authorization is enforced server-side and by RLS.
 */
/** Request header carrying the current path, so layouts can build sign-in `?next=` links. */
export const PATHNAME_HEADER = "x-coretech-pathname";

export async function updateSession(request: NextRequest) {
  // Always overwrite: a client-supplied value must never be trusted.
  request.headers.set(PATHNAME_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  let response = NextResponse.next({ request });

  const env = getSupabasePublicEnv();
  if (!env) return response;

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        // Prevent CDNs from caching responses that carry a user's auth cookies.
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Do not insert logic between client creation and getClaims(); it validates and refreshes the session.
  await supabase.auth.getClaims();

  return response;
}
