import { describe, expect, it } from "vitest";

import { parseSupabasePublicEnv } from "@/lib/env";

const validKey = "sb_publishable_0123456789abcdef";

describe("parseSupabasePublicEnv", () => {
  it("returns null when Supabase is not configured", () => {
    expect(parseSupabasePublicEnv({})).toBeNull();
    expect(
      parseSupabasePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: " ", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" }),
    ).toBeNull();
  });

  it("parses a complete configuration", () => {
    expect(
      parseSupabasePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: validKey,
      }),
    ).toEqual({ url: "https://abc.supabase.co", publishableKey: validKey });
  });

  it("throws on a partial configuration instead of silently disabling auth", () => {
    expect(() =>
      parseSupabasePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("throws on a malformed URL", () => {
    expect(() =>
      parseSupabasePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: validKey,
      }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("never reads server-only secrets", () => {
    const result = parseSupabasePublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: validKey,
      SUPABASE_SECRET_KEY: "sb_secret_should_not_leak",
    });
    expect(JSON.stringify(result)).not.toContain("sb_secret");
  });
});
