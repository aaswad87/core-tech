import { createClient } from "@supabase/supabase-js";

import { getSupabasePublicEnv } from "@/lib/env";

/**
 * Session-less client with the publishable key, for public data (the job board, sitemap).
 * Runs as `anon`, so RLS and function grants apply. Returns null when Supabase is not configured.
 */
export function createPublicClient() {
  const env = getSupabasePublicEnv();
  if (!env) return null;
  return createClient(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
