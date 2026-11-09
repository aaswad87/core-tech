import "server-only";

import { createClient } from "@supabase/supabase-js";

import { requireSupabasePublicEnv } from "@/lib/env";
import { getSupabaseSecretKey } from "@/lib/env.server";

/**
 * Service-role client. BYPASSES ROW LEVEL SECURITY.
 * Use only in server actions/route handlers for operations that have already been validated and
 * authorized in code, and never pass user-controlled filters to it unchecked.
 */
export function createAdminClient() {
  const { url } = requireSupabasePublicEnv();
  const secretKey = getSupabaseSecretKey();
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY is not configured");

  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
