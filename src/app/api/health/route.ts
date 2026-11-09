import { NextResponse } from "next/server";

import { getSupabasePublicEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Health check for uptime monitors. Public and contains no secrets or user data: it reports whether the
 * app is up and whether it can reach the database (using the same anonymous job-board call as /jobs).
 * 200 = healthy, 503 = the database is unreachable or not configured.
 */
export async function GET() {
  const version = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local";
  let env: ReturnType<typeof getSupabasePublicEnv>;
  try {
    env = getSupabasePublicEnv();
  } catch {
    return NextResponse.json({ status: "degraded", version, database: "misconfigured" }, { status: 503, headers: NO_STORE });
  }
  if (!env) {
    return NextResponse.json({ status: "degraded", version, database: "not_configured" }, { status: 503, headers: NO_STORE });
  }

  const started = Date.now();
  try {
    const res = await fetch(`${env.url}/rest/v1/rpc/get_published_jobs`, {
      method: "POST",
      headers: { apikey: env.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ p_limit: 1, p_offset: 0 }),
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    const ok = res.ok;
    return NextResponse.json(
      { status: ok ? "ok" : "degraded", version, database: ok ? "ok" : "error", latencyMs: Date.now() - started },
      { status: ok ? 200 : 503, headers: NO_STORE },
    );
  } catch {
    return NextResponse.json({ status: "degraded", version, database: "unreachable" }, { status: 503, headers: NO_STORE });
  }
}
