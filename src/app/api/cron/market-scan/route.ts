import { type NextRequest, NextResponse } from "next/server";

import { siteConfig } from "@/config/site";
import { getMarketConfig, isLeadCaptureConfigured } from "@/lib/env.server";
import { isAuthorizedCron } from "@/lib/market/cron-auth";
import { createSupabaseMarketRepo } from "@/lib/market/repo";
import { runMarketScan } from "@/lib/market/scan";

// A scan calls several external APIs; allow it time to finish (Vercel Pro allows up to 300s).
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };

/** Scheduled Job Radar scan. Requires "Authorization: Bearer <CRON_SECRET>". */
export async function GET(request: NextRequest) {
  let config;
  try {
    config = getMarketConfig();
  } catch (e) {
    console.error("Job Radar config invalid", (e as Error).message);
    return NextResponse.json({ error: "Job Radar is misconfigured" }, { status: 500, headers: NO_STORE });
  }

  if (!isAuthorizedCron(request.headers.get("authorization"), config.cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!isLeadCaptureConfigured()) {
    return NextResponse.json({ error: "Supabase secret key is not configured" }, { status: 503, headers: NO_STORE });
  }

  const result = await runMarketScan({
    repo: createSupabaseMarketRepo(),
    config,
    fetchImpl: fetch,
    appUrl: siteConfig.url,
    trigger: "schedule",
  });

  // Counts only — no posting data or secrets in the response.
  return NextResponse.json(
    result.status === "skipped" ? { status: "skipped" } : { status: result.status, stats: result.stats, errorCount: result.errors.length },
    { status: result.status === "failed" ? 500 : 200, headers: NO_STORE },
  );
}
