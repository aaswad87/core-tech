import { describe, expect, it } from "vitest";

// Plain .mjs helper shared with scripts/preflight.mjs.
import { hasFailures, runPreflight } from "../../scripts/preflight-checks.mjs";

type Result = { level: "pass" | "warn" | "fail"; name: string; detail: string };
const levelOf = (results: Result[], name: string) => results.find((r) => r.name === name)?.level;

const good = {
  NEXT_PUBLIC_SITE_URL: "https://coretechrecruiting.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xxxxxxxxxxxxxxxxxxxx",
  SUPABASE_SECRET_KEY: "sb_secret_xxxxxxxxxxxxxxxxxxxx",
  CRON_SECRET: "x".repeat(40),
  RESEND_API_KEY: "re_test",
  MARKET_ALERTS_FROM: "CoreTech <alerts@coretechrecruiting.com>",
};

describe("runPreflight", () => {
  it("passes a complete production config", () => {
    const r: Result[] = runPreflight(good, { legalReviewed: true });
    expect(hasFailures(r)).toBe(false);
    expect(r.filter((x) => x.level === "warn")).toEqual([]);
  });

  it("fails http or missing site URLs and missing secrets", () => {
    const r: Result[] = runPreflight({ ...good, NEXT_PUBLIC_SITE_URL: "http://coretech.com", SUPABASE_SECRET_KEY: "", CRON_SECRET: "short" });
    expect(levelOf(r, "NEXT_PUBLIC_SITE_URL")).toBe("fail");
    expect(levelOf(r, "SUPABASE_SECRET_KEY")).toBe("fail");
    expect(levelOf(r, "CRON_SECRET")).toBe("fail");
  });

  it("catches a publishable key pasted as the secret, and secrets exposed with NEXT_PUBLIC_", () => {
    const r: Result[] = runPreflight({ ...good, SUPABASE_SECRET_KEY: "sb_publishable_abc", NEXT_PUBLIC_OPENAI_API_KEY: "sk-1" });
    expect(levelOf(r, "SUPABASE_SECRET_KEY")).toBe("fail");
    expect(levelOf(r, "NEXT_PUBLIC_OPENAI_API_KEY")).toBe("fail");
  });

  it("warns about unverified-looking email domains, draft legal pages and vercel.app URLs", () => {
    const r: Result[] = runPreflight(
      { ...good, NEXT_PUBLIC_SITE_URL: "https://coretech.vercel.app", MARKET_ALERTS_FROM: "CoreTech <a@gmail.com>" },
      { legalReviewed: false },
    );
    expect(levelOf(r, "NEXT_PUBLIC_SITE_URL")).toBe("warn");
    expect(levelOf(r, "Email (Resend)")).toBe("warn");
    expect(levelOf(r, "Legal pages")).toBe("warn");
  });

  it("requires AI credentials once the privacy flag is on", () => {
    expect(levelOf(runPreflight({ ...good, AI_PRIVACY_REVIEW_APPROVED: "true" }), "AI parsing")).toBe("fail");
    expect(levelOf(runPreflight({ ...good, AI_PRIVACY_REVIEW_APPROVED: "true", OPENAI_API_KEY: "k", OPENAI_MODEL: "m" }), "AI parsing")).toBe("warn");
  });

  it("never echoes values in its messages", () => {
    const r: Result[] = runPreflight({ ...good, SUPABASE_SECRET_KEY: "sb_secret_SUPERSECRETVALUE123" });
    expect(JSON.stringify(r)).not.toContain("SUPERSECRETVALUE");
  });
});
