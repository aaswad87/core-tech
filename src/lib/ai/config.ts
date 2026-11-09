/**
 * AI resume parsing configuration (server-only environment variables). Pure so it can be unit-tested;
 * `getAiConfig()` in env.server.ts binds it to process.env.
 *
 *   AI_PRIVACY_REVIEW_APPROVED=true  Set only after the privacy/security review in README → AI resume parsing.
 *   OPENAI_API_KEY, OPENAI_MODEL     Provider credentials and the model to use (no default model is assumed).
 *   AI_HOURLY_LIMIT                  Requests per person per hour (default 10)
 *   AI_MONTHLY_PARSE_LIMIT           Requests per organization per calendar month (default 200)
 *   AI_MONTHLY_TOKEN_BUDGET          Optional cap on total tokens per month
 *   AI_MAX_INPUT_CHARS               Resume text sent per request, after redaction (default 24000)
 */
export type AiConfig =
  | {
      enabled: true;
      provider: "openai";
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
  const apiKey = value(env, "OPENAI_API_KEY");
  const model = value(env, "OPENAI_MODEL");
  if (!apiKey) missing.push("OPENAI_API_KEY");
  if (!model) missing.push("OPENAI_MODEL");
  if (model && !/^[A-Za-z0-9._:-]{1,100}$/.test(model)) throw new Error("OPENAI_MODEL contains unexpected characters");

  const hourlyLimit = positiveInt(value(env, "AI_HOURLY_LIMIT"), 10, "AI_HOURLY_LIMIT", 1000);
  const monthlyLimit = positiveInt(value(env, "AI_MONTHLY_PARSE_LIMIT"), 200, "AI_MONTHLY_PARSE_LIMIT", 100_000);
  const budgetRaw = value(env, "AI_MONTHLY_TOKEN_BUDGET");
  const monthlyTokenBudget = budgetRaw === null ? null : positiveInt(budgetRaw, 0, "AI_MONTHLY_TOKEN_BUDGET", 2_000_000_000);
  const maxInputChars = positiveInt(value(env, "AI_MAX_INPUT_CHARS"), 24_000, "AI_MAX_INPUT_CHARS", 200_000);

  if (missing.length) return { enabled: false, missing };
  return { enabled: true, provider: "openai", apiKey: apiKey!, model: model!, hourlyLimit, monthlyLimit, monthlyTokenBudget, maxInputChars };
}
