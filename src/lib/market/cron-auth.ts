import { timingSafeEqual } from "node:crypto";

/**
 * Checks "Authorization: Bearer <CRON_SECRET>" in constant time. Vercel Cron sends this header
 * automatically when CRON_SECRET is set; other schedulers (Supabase pg_cron, GitHub Actions) send it too.
 */
export function isAuthorizedCron(authorization: string | null, secret: string | null): boolean {
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const given = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
