import { describe, expect, it } from "vitest";

import { clientIpFromHeaders, hashIp, isRateLimited, LEAD_RATE_LIMITS, windowStart } from "@/lib/leads/rate-limit";

describe("lead rate limiting", () => {
  it("takes the first forwarded IP", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIpFromHeaders(new Headers())).toBeNull();
  });

  it("hashes IPs with a secret so they can't be read back", () => {
    const a = hashIp("203.0.113.5", "secret-one");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("203");
    expect(hashIp("203.0.113.5", "secret-one")).toBe(a);
    expect(hashIp("203.0.113.5", "secret-two")).not.toBe(a);
  });

  it("limits by IP and by email", () => {
    expect(isRateLimited({ ip: LEAD_RATE_LIMITS.perIp.max - 1, email: 0 })).toBe(false);
    expect(isRateLimited({ ip: LEAD_RATE_LIMITS.perIp.max, email: 0 })).toBe(true);
    expect(isRateLimited({ ip: null, email: LEAD_RATE_LIMITS.perEmail.max })).toBe(true);
    expect(isRateLimited({ ip: null, email: 0 })).toBe(false);
  });

  it("computes the window start", () => {
    expect(windowStart(15, new Date("2026-10-30T12:00:00Z"))).toBe("2026-10-30T11:45:00.000Z");
  });
});
