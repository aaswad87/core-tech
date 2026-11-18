/**
 * AI resume parsing configuration (server-only environment variables). Pure so it can be unit-tested;
 * `getAiConfig()` in env.server.ts binds it to process.env.
 *
 *   AI_PRIVACY_REVIEW_APPROVED=true  Set only after the privacy/security review in README → AI resume parsing.
 *   ANTHROPIC_API_KEY                Claude API key (platform.claude.com). Server-only.
 *   ANTHROPIC_MODEL                  Optional; defaults to Claude Haiku 5.5 (the operator's choice, 2026-11-18).
 *   AI_HOURLY_LIMIT                  Requests per person per hour (default 10)
 *   AI_MONTHLY_PARSE_LIMIT           Requests per organization per calendar month (default 200)
 *   AI_MONTHLY_TOKEN_BUDGET          Optional cap on total tokens per month
 *   AI_MAX_INPUT_CHARS               Resume text sent per request, after redaction (default 24000)
 */
export const DEFAULT_CLAUDE_MODEL = "claude-haiku-5-5";

export type AiConfig =
  | {
      enabled: true;
      provider: "anthropic";
      apiKey: string;
      model: string;
      hourlyLimit: number;
      monthlyLimit: number;
      monthlyTokenBudget: number | null;
      maxInputChars: number;
    }
  | { enabled: false; missing: string[] };

const value = (env: Record<string, string | undefined>, key: string) => env[key]?.trim() || null;

function positiveInt(raw: string | null, fallback: number, key: string, max: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${key} must be a whole number between 1 and ${max}`);
  return n;
}

export function parseAiConfig(env: Record<string, string | undefined>): AiConfig {
  const missing: string[] = [];
  if (value(env, "AI_PRIVACY_REVIEW_APPROVED") !== "true") missing.push("Privacy and security review (AI_PRIVACY_REVIEW_APPROVED=true)");
  const apiKey = value(env, "ANTHROPIC_API_KEY");
  const model = value(env, "ANTHROPIC_MODEL") ?? DEFAULT_CLAUDE_MODEL;
  if (!apiKey) missing.push("ANTHROPIC_API_KEY");
  if (!/^claude-[a-z0-9.-]{1,80}$/.test(model)) throw new Error("ANTHROPIC_MODEL must be a Claude model ID such as claude-haiku-5-5");

  const hourlyLimit = positiveInt(value(env, "AI_HOURLY_LIMIT"), 10, "AI_HOURLY_LIMIT", 1000);
  const monthlyLimit = positiveInt(value(env, "AI_MONTHLY_PARSE_LIMIT"), 200, "AI_MONTHLY_PARSE_LIMIT", 100_000);
  const budgetRaw = value(env, "AI_MONTHLY_TOKEN_BUDGET");
  const monthlyTokenBudget = budgetRaw === null ? null : positiveInt(budgetRaw, 0, "AI_MONTHLY_TOKEN_BUDGET", 2_000_000_000);
  const maxInputChars = positiveInt(value(env, "AI_MAX_INPUT_CHARS"), 24_000, "AI_MAX_INPUT_CHARS", 200_000);

  if (missing.length) return { enabled: false, missing };
  return { enabled: true, provider: "anthropic", apiKey: apiKey!, model, hourlyLimit, monthlyLimit, monthlyTokenBudget, maxInputChars };
}
