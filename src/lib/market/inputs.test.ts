import { describe, expect, it } from "vitest";

import { isAuthorizedCron } from "@/lib/market/cron-auth";
import { extractBoardToken, huntSchema, parseTerms, watchCompanySchema } from "@/lib/market/validation";
import { toFieldErrors } from "@/lib/validation/auth";

const SECRET = "s".repeat(40);

describe("cron authorization", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorizedCron(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedCron(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedCron(null, SECRET)).toBe(false);
    // Without a configured secret, nothing is authorized.
    expect(isAuthorizedCron("Bearer ", null)).toBe(false);
  });
});

describe("hunt input", () => {
  it("splits, trims and dedupes terms", () => {
    expect(parseTerms("network engineer, BGP\n bgp ,SD-WAN,, ")).toEqual(["network engineer", "BGP", "SD-WAN"]);
  });

  it("validates a hunt", () => {
    const ok = huntSchema.parse({
      name: "Texas network",
      keywords: "network engineer, BGP",
      excludeKeywords: "",
      locations: "Texas\nOklahoma",
      includeRemote: "on",
      sources: ["jsearch", "greenhouse"],
      minScore: "3",
    });
    expect(ok).toMatchObject({ keywords: ["network engineer", "BGP"], locations: ["Texas", "Oklahoma"], includeRemote: true, minScore: 3 });

    const bad = huntSchema.safeParse({ name: "", keywords: "", sources: [], minScore: "0", includeRemote: "" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(Object.keys(toFieldErrors(bad.error)).sort()).toEqual(["keywords", "minScore", "name", "sources"]);
    expect(huntSchema.safeParse({ name: "x", keywords: "a", sources: ["indeed"], minScore: "3" }).success).toBe(false);
  });
});

describe("watched company input", () => {
  it("extracts board tokens from careers links", () => {
    expect(extractBoardToken("https://boards.greenhouse.io/acme", "greenhouse")).toBe("acme");
    expect(extractBoardToken("https://job-boards.greenhouse.io/acme/jobs/123", "greenhouse")).toBe("acme");
    expect(extractBoardToken("jobs.lever.co/acme-inc/5ac2", "lever")).toBe("acme-inc");
    expect(extractBoardToken("acme", "lever")).toBe("acme");
  });

  it("rejects links to other sites and unsafe tokens", () => {
    expect(extractBoardToken("https://evil.test/acme", "greenhouse")).toBeNull();
    expect(extractBoardToken("https://jobs.lever.co/acme", "greenhouse")).toBeNull();
    expect(extractBoardToken("../etc/passwd", "lever")).toBeNull();
    expect(watchCompanySchema.safeParse({ companyName: "Acme", source: "lever", board: "https://evil.test/x" }).success).toBe(false);
    expect(watchCompanySchema.parse({ companyName: "Acme", source: "greenhouse", board: "https://boards.greenhouse.io/acme" })).toEqual({
      companyName: "Acme",
      source: "greenhouse",
      boardToken: "acme",
    });
  });
});
