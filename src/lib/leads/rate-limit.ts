import { createHmac } from "node:crypto";

export const LEAD_RATE_LIMITS = {
  /** Submissions allowed from one IP address per window. */
  perIp: { max: 5, windowMinutes: 15 },
  /** Submissions allowed for one email address per window. */
  perEmail: { max: 3, windowMinutes: 60 },
} as const;

/**
 * Picks the client IP from proxy headers. On Vercel, x-forwarded-for is set by the platform.
 * Returns null when no IP is available (e.g. some local setups); callers then rate-limit by email only.
 */
export function clientIpFromHeaders(headers: Pick<Headers, "get">): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip")?.trim();
  return ip && ip.length <= 64 ? ip : null;
}

/** Keyed hash so stored values cannot be reversed into IP addresses without the server secret. */
export function hashIp(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(ip).digest("hex");
}

export function isRateLimited(counts: { ip: number | null; email: number }): boolean {
  if (counts.ip !== null && counts.ip >= LEAD_RATE_LIMITS.perIp.max) return true;
  return counts.email >= LEAD_RATE_LIMITS.perEmail.max;
}

export function windowStart(minutes: number, now: Date = new Date()): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}
