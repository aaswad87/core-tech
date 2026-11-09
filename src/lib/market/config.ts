/**
 * Job Market Radar configuration, read from server-only environment variables. Pure (takes the env
 * object) so it can be unit-tested; `getMarketConfig()` in env.server.ts binds it to process.env.
 *
 *   ADZUNA_APP_ID, ADZUNA_APP_KEY      Adzuna job search API
 *   JSEARCH_RAPIDAPI_KEY               JSearch on RapidAPI (Indeed, Dice, LinkedIn, company sites)
 *   RESEND_API_KEY, MARKET_ALERTS_FROM Email alerts (from = "Name <address@verified-domain>")
 *   SLACK_MARKET_WEBHOOK_URL           Optional Slack incoming webhook for team alerts
 *   CRON_SECRET                        Shared secret the scheduler sends as "Authorization: Bearer …"
 */
export type MarketConfig = {
  adzuna: { appId: string; appKey: string } | null;
  jsearch: { apiKey: string } | null;
  email: { apiKey: string; from: string } | null;
  slackWebhookUrl: string | null;
  cronSecret: string | null;
};

const value = (env: Record<string, string | undefined>, key: string) => env[key]?.trim() || null;

export function parseMarketConfig(env: Record<string, string | undefined>): MarketConfig {
  const adzunaId = value(env, "ADZUNA_APP_ID");
  const adzunaKey = value(env, "ADZUNA_APP_KEY");
  const resendKey = value(env, "RESEND_API_KEY");
  const from = value(env, "MARKET_ALERTS_FROM");
  const slack = value(env, "SLACK_MARKET_WEBHOOK_URL");
  const cron = value(env, "CRON_SECRET");

  if (Boolean(adzunaId) !== Boolean(adzunaKey)) throw new Error("Set both ADZUNA_APP_ID and ADZUNA_APP_KEY, or neither");
  if (Boolean(resendKey) !== Boolean(from)) throw new Error("Set both RESEND_API_KEY and MARKET_ALERTS_FROM, or neither");
  if (from && !/^(?:[^<>@\r\n]+ )?<?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(from)) {
    throw new Error("MARKET_ALERTS_FROM must look like 'CoreTech Radar <radar@your-domain.com>'");
  }
  if (slack && !/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(slack)) {
    throw new Error("SLACK_MARKET_WEBHOOK_URL must be a https://hooks.slack.com/services/… URL");
  }
  if (cron && cron.length < 32) throw new Error("CRON_SECRET must be at least 32 characters");

  return {
    adzuna: adzunaId && adzunaKey ? { appId: adzunaId, appKey: adzunaKey } : null,
    jsearch: value(env, "JSEARCH_RAPIDAPI_KEY") ? { apiKey: value(env, "JSEARCH_RAPIDAPI_KEY")! } : null,
    email: resendKey && from ? { apiKey: resendKey, from } : null,
    slackWebhookUrl: slack,
    cronSecret: cron,
  };
}
