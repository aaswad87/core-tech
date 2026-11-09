import "server-only";

import { z } from "zod";

import { type AiConfig, parseAiConfig } from "@/lib/ai/config";
import { getSupabasePublicEnv } from "@/lib/env";
import { type MarketConfig, parseMarketConfig } from "@/lib/market/config";

const secretKeySchema = z.string().trim().min(20);

/**
 * The Supabase secret (service-role) key. It bypasses RLS, so it must only be used in server code
 * for narrowly scoped operations (currently: inserting validated leads). Never import this module
 * from a client component.
 */
export function getSupabaseSecretKey(): string | null {
  const raw = process.env.SUPABASE_SECRET_KEY;
  if (!raw || !raw.trim()) return null;
  const parsed = secretKeySchema.safeParse(raw);
  if (!parsed.success) throw new Error("Invalid SUPABASE_SECRET_KEY");
  return parsed.data;
}

/** Job Market Radar sources, email/Slack alerts and cron secret. See src/lib/market/config.ts. */
export function getMarketConfig(): MarketConfig {
  return parseMarketConfig(process.env);
}

/** AI resume parsing. Off until the privacy review flag and provider credentials are set. See src/lib/ai/config.ts. */
export function getAiConfig(): AiConfig {
  return parseAiConfig(process.env);
}

/** Whether to offer AI parsing in the UI. A misconfigured setup counts as off (the action reports why). */
export function isAiEnabled(): boolean {
  try {
    return getAiConfig().enabled;
  } catch {
    return false;
  }
}

/** Lead forms need both the public project settings and the server-only secret key. */
export function isLeadCaptureConfigured(): boolean {
  return getSupabasePublicEnv() !== null && getSupabaseSecretKey() !== null;
}
