import { z } from "zod";

/**
 * Public (browser-safe) environment. Only NEXT_PUBLIC_* values may live here.
 * Secrets such as the Supabase secret/service-role key must never be read in this module.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
});

export type SupabasePublicEnv = {
  url: string;
  publishableKey: string;
};

type RawEnv = Record<string, string | undefined>;

/**
 * Returns the Supabase public config, or null when Supabase is not configured.
 * Throws if values are present but malformed so misconfiguration fails loudly.
 */
export function parseSupabasePublicEnv(raw: RawEnv): SupabasePublicEnv | null {
  const url = raw.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = raw.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url && !publishableKey) return null;

  const result = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  });

  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid Supabase environment configuration: ${fields}`);
  }

  return {
    url: result.data.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: result.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

// NEXT_PUBLIC_* values are inlined at build time, so they must be referenced literally.
export function getSupabasePublicEnv(): SupabasePublicEnv | null {
  return parseSupabasePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

export function isSupabaseConfigured(): boolean {
  return getSupabasePublicEnv() !== null;
}

export function requireSupabasePublicEnv(): SupabasePublicEnv {
  const env = getSupabasePublicEnv();
  if (!env) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example).",
    );
  }
  return env;
}
