/**
 * Production readiness checks (pure; tested in src/lib/preflight.test.ts). `scripts/preflight.mjs` runs
 * them against an env file before a deployment. Each result is "pass", "warn" (launch possible, but read
 * it) or "fail" (fix before launch). Values are never printed — only whether they look right.
 */

const has = (env, key) => Boolean(env[key]?.trim());

export function runPreflight(env, facts = {}) {
  const out = [];
  const add = (level, name, detail) => out.push({ level, name, detail });

  // Site URL
  const site = env.NEXT_PUBLIC_SITE_URL?.trim() ?? "";
  if (!site) add("fail", "NEXT_PUBLIC_SITE_URL", "Not set. Use your real https:// address, e.g. https://coretechrecruiting.com");
  else if (!/^https:\/\//.test(site)) add("fail", "NEXT_PUBLIC_SITE_URL", "Must start with https:// in production (HSTS and secure cookies depend on it).");
  else if (/localhost|127\.0\.0\.1|vercel\.app/.test(site)) add("warn", "NEXT_PUBLIC_SITE_URL", "Points at a local or *.vercel.app address. Use your own domain for launch.");
  else add("pass", "NEXT_PUBLIC_SITE_URL", "https address set.");

  // Supabase
  const sbUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  if (!sbUrl || !has(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")) add("fail", "Supabase", "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are both required.");
  else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(sbUrl)) add("warn", "Supabase", "The project URL doesn't look like https://<ref>.supabase.co — double-check it.");
  else add("pass", "Supabase", "Project URL and publishable key set.");

  const secret = env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!secret) add("fail", "SUPABASE_SECRET_KEY", "Needed for website inquiry forms and the scheduled Job Radar scan. Server-only — add it in Vercel, never with a NEXT_PUBLIC_ prefix.");
  else if (secret.startsWith("sb_publishable_")) add("fail", "SUPABASE_SECRET_KEY", "This is the publishable key, not the secret key.");
  else add("pass", "SUPABASE_SECRET_KEY", "Set.");

  for (const key of Object.keys(env)) {
    if (/^NEXT_PUBLIC_.*(SECRET|SERVICE|PRIVATE|API_KEY|PASSWORD)/i.test(key) && key !== "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") {
      add("fail", key, "Anything starting with NEXT_PUBLIC_ is sent to every visitor's browser. Rename it without the prefix.");
    }
  }

  // Scheduled scan
  const cron = env.CRON_SECRET?.trim() ?? "";
  if (cron.length >= 32) add("pass", "CRON_SECRET", "Set (32+ characters).");
  else add("fail", "CRON_SECRET", "Must be at least 32 random characters; Vercel Cron sends it to /api/cron/market-scan.");

  // Email
  const resend = has(env, "RESEND_API_KEY");
  const from = env.MARKET_ALERTS_FROM?.trim() ?? "";
  if (!resend && !from) add("warn", "Email (Resend)", "Not configured: interview emails and Job Radar alerts won't be sent (the app says so on each page).");
  else if (resend !== Boolean(from)) add("fail", "Email (Resend)", "Set both RESEND_API_KEY and MARKET_ALERTS_FROM, or neither.");
  else {
    const fromDomain = (from.match(/@([^>\s]+)>?$/) ?? [])[1]?.toLowerCase();
    const siteDomain = site.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();
    if (fromDomain && siteDomain && !fromDomain.endsWith(siteDomain)) add("warn", "Email (Resend)", `Sender domain ${fromDomain} differs from the site domain ${siteDomain}. It must be verified in Resend.`);
    else add("pass", "Email (Resend)", "API key and sender set. Make sure the domain shows Verified in Resend.");
  }

  // AI
  if (env.AI_PRIVACY_REVIEW_APPROVED?.trim() === "true") {
    if (!has(env, "OPENAI_API_KEY") || !has(env, "OPENAI_MODEL")) add("fail", "AI parsing", "Privacy review flag is on but OPENAI_API_KEY / OPENAI_MODEL are missing.");
    else if (!has(env, "AI_MONTHLY_TOKEN_BUDGET")) add("warn", "AI parsing", "On, without AI_MONTHLY_TOKEN_BUDGET. Set a budget that matches your spending limit.");
    else add("pass", "AI parsing", "On, with a monthly token budget.");
  } else add("pass", "AI parsing", "Off (turn on only after the privacy review in the README).");

  // Facts read from the codebase
  if (facts.legalReviewed === false) add("warn", "Legal pages", "LEGAL_REVIEWED is false: privacy notice and terms show a draft banner. Have them reviewed before launch.");
  else if (facts.legalReviewed === true) add("pass", "Legal pages", "Marked as reviewed.");

  if (has(env, "ALLOW_SIMULATED_PAYMENTS") || env.NODE_ENV === "development") add("warn", "Development flags", "Development-only settings are present in this env file.");

  return out;
}

/** Exit code: 1 when anything failed. */
export const hasFailures = (results) => results.some((r) => r.level === "fail");
