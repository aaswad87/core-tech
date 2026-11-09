import "server-only";

import { getMarketConfig } from "@/lib/env.server";
import type { MarketSource } from "@/lib/market/types";
import { createClient } from "@/lib/supabase/server";

/** Reads for the Job Radar pages. Run as the signed-in user, so RLS limits everything to staff. */

export type MatchListItem = {
  id: string;
  status: string;
  score: number;
  matchedTerms: string[];
  createdAt: string;
  notifiedAt: string | null;
  huntId: string;
  huntName: string;
  posting: {
    title: string;
    companyName: string | null;
    location: string | null;
    isRemote: boolean;
    source: MarketSource;
    postedAt: string | null;
    url: string;
  };
};

type MatchRow = {
  id: string;
  status: string;
  score: number;
  matched_terms: string[];
  created_at: string;
  notified_at: string | null;
  hunt_id: string;
  market_hunts: { name: string } | null;
  market_postings: {
    title: string;
    company_name: string | null;
    location: string | null;
    is_remote: boolean;
    source: MarketSource;
    posted_at: string | null;
    url: string;
  } | null;
};

const MATCH_SELECT =
  "id, status, score, matched_terms, created_at, notified_at, hunt_id, market_hunts(name), market_postings(title, company_name, location, is_remote, source, posted_at, url)";

function toItem(r: MatchRow): MatchListItem | null {
  if (!r.market_postings) return null;
  return {
    id: r.id,
    status: r.status,
    score: r.score,
    matchedTerms: r.matched_terms,
    createdAt: r.created_at,
    notifiedAt: r.notified_at,
    huntId: r.hunt_id,
    huntName: r.market_hunts?.name ?? "Deleted hunt",
    posting: {
      title: r.market_postings.title,
      companyName: r.market_postings.company_name,
      location: r.market_postings.location,
      isRemote: r.market_postings.is_remote,
      source: r.market_postings.source,
      postedAt: r.market_postings.posted_at,
      url: r.market_postings.url,
    },
  };
}

export const MATCHES_PAGE_SIZE = 30;

export async function listMatches(filter: { status: string; huntId: string | null; page: number }) {
  const supabase = await createClient();
  let query = supabase
    .from("market_matches")
    .select(MATCH_SELECT, { count: "exact" })
    .eq("status", filter.status)
    .order("created_at", { ascending: false })
    .range((filter.page - 1) * MATCHES_PAGE_SIZE, filter.page * MATCHES_PAGE_SIZE - 1);
  if (filter.huntId) query = query.eq("hunt_id", filter.huntId);
  const { data, error, count } = await query;
  if (error) throw new Error(`Failed to load matches: ${error.message}`);
  return {
    items: ((data ?? []) as unknown as MatchRow[]).map(toItem).filter((i): i is MatchListItem => i !== null),
    total: count ?? 0,
  };
}

export async function countNewMatches(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase.from("market_matches").select("id", { count: "exact", head: true }).eq("status", "new");
  return count ?? 0;
}

export async function getMatchDetail(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("market_matches")
    .select(
      "id, status, score, matched_terms, created_at, notified_at, hunt_id, pursued_job_id, reviewed_by, reviewed_at, market_hunts(name, keywords, locations), market_postings(title, company_name, location, is_remote, source, posted_at, url, employment_type, salary_min, salary_max, description_snippet, first_seen_at)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load match: ${error.message}`);
  return data as unknown as
    | (Omit<MatchRow, "market_hunts" | "market_postings"> & {
        pursued_job_id: string | null;
        reviewed_by: string | null;
        reviewed_at: string | null;
        market_hunts: { name: string; keywords: string[]; locations: string[] } | null;
        market_postings:
          | (NonNullable<MatchRow["market_postings"]> & {
              employment_type: string | null;
              salary_min: number | null;
              salary_max: number | null;
              description_snippet: string | null;
              first_seen_at: string;
            })
          | null;
      })
    | null;
}

export type HuntRow = {
  id: string;
  name: string;
  keywords: string[];
  exclude_keywords: string[];
  locations: string[];
  include_remote: boolean;
  sources: MarketSource[];
  min_score: number;
  is_active: boolean;
  created_by: string | null;
  last_scanned_at: string | null;
  market_hunt_subscribers: { user_id: string }[];
};

export async function listHunts(): Promise<HuntRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("market_hunts")
    .select("id, name, keywords, exclude_keywords, locations, include_remote, sources, min_score, is_active, created_by, last_scanned_at, market_hunt_subscribers(user_id)")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to load hunts: ${error.message}`);
  return (data ?? []) as HuntRow[];
}

export async function listWatchCompanies() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("market_watch_companies")
    .select("id, company_name, source, board_token, is_active")
    .order("company_name");
  if (error) throw new Error(`Failed to load watched companies: ${error.message}`);
  return (data ?? []) as { id: string; company_name: string; source: "greenhouse" | "lever"; board_token: string; is_active: boolean }[];
}

export async function getLastRun() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("market_scan_runs")
    .select("id, trigger, status, started_at, finished_at, stats, errors")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as
    | {
        id: string;
        trigger: string;
        status: string;
        started_at: string;
        finished_at: string | null;
        stats: Record<string, number>;
        errors: { source: string; target: string; message: string }[];
      }
    | null;
}

export type CandidateSuggestion = {
  id: string;
  name: string;
  headline: string | null;
  location: string | null;
  matchedTerms: string[];
  sameArea: boolean;
};

/**
 * Candidates already in our database with evidence of the posting's matched skills. Ranked by how many
 * terms they match, then by location. A suggestion only — recruiters decide who to contact.
 */
export async function suggestCandidates(terms: string[], postingLocation: string | null): Promise<CandidateSuggestion[]> {
  const supabase = await createClient();
  const byId = new Map<string, CandidateSuggestion>();
  const results = await Promise.all(
    terms.slice(0, 6).map(async (term) => ({
      term,
      res: await supabase.rpc("search_candidates", { p_query: term, p_limit: 25, p_offset: 0 }),
    })),
  );
  for (const { term, res } of results) {
    for (const c of (res.data ?? []) as { id: string; first_name: string; last_name: string; headline: string | null; location: string | null }[]) {
      const entry = byId.get(c.id) ?? {
        id: c.id,
        name: `${c.first_name} ${c.last_name}`,
        headline: c.headline,
        location: c.location,
        matchedTerms: [],
        sameArea: false,
      };
      entry.matchedTerms.push(term);
      byId.set(c.id, entry);
    }
  }
  const area = postingLocation?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) ?? [];
  for (const s of byId.values()) {
    const loc = s.location?.toLowerCase() ?? "";
    s.sameArea = area.some((part) => part.length > 1 && loc.includes(part));
  }
  return [...byId.values()]
    .sort((a, b) => b.matchedTerms.length - a.matchedTerms.length || Number(b.sameArea) - Number(a.sameArea))
    .slice(0, 10);
}

/** Which sources/channels are configured — booleans only, never key values. */
export function getRadarSetupStatus() {
  try {
    const c = getMarketConfig();
    return {
      ok: true as const,
      adzuna: Boolean(c.adzuna),
      jsearch: Boolean(c.jsearch),
      email: Boolean(c.email),
      slack: Boolean(c.slackWebhookUrl),
      cron: Boolean(c.cronSecret),
    };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Invalid Job Radar configuration" };
  }
}
