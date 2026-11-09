import "server-only";

import type { MarketRepo, StoredPosting } from "@/lib/market/scan";
import type { Hunt, MarketSource, WatchCompany } from "@/lib/market/types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * MarketRepo backed by the service-role client. The scheduled scan has no signed-in user, so it runs
 * with the secret key; it only ever writes market_* tables and notification_deliveries.
 */
export function createSupabaseMarketRepo(): MarketRepo {
  const db = createAdminClient();

  const must = <T>(result: { data: T | null; error: { message: string } | null }, what: string): T => {
    if (result.error) throw new Error(`${what}: ${result.error.message}`);
    return result.data as T;
  };

  return {
    async getOrganizationId() {
      const org = must(await db.from("organizations").select("id").eq("is_default", true).single(), "organization");
      return (org as unknown as { id: string }).id;
    },

    async hasRunSince(orgId, sinceIso) {
      const rows = must(
        await db.from("market_scan_runs").select("id").eq("organization_id", orgId).gte("started_at", sinceIso).limit(1),
        "recent runs",
      );
      return (rows as unknown[]).length > 0;
    },

    async startRun(orgId, trigger, triggeredBy) {
      const row = must(
        await db
          .from("market_scan_runs")
          .insert({ organization_id: orgId, trigger, triggered_by: triggeredBy })
          .select("id")
          .single(),
        "start run",
      );
      return (row as unknown as { id: string }).id;
    },

    async finishRun(runId, status, stats, errors) {
      must(
        await db
          .from("market_scan_runs")
          .update({ status, stats, errors: errors.slice(0, 50), finished_at: new Date().toISOString() })
          .eq("id", runId),
        "finish run",
      );
    },

    async listActiveHunts(orgId) {
      const rows = must(
        await db
          .from("market_hunts")
          .select("id, name, keywords, exclude_keywords, locations, include_remote, sources, min_score")
          .eq("organization_id", orgId)
          .eq("is_active", true),
        "hunts",
      ) as Record<string, unknown>[];
      return rows.map(
        (r): Hunt => ({
          id: r.id as string,
          name: r.name as string,
          keywords: r.keywords as string[],
          excludeKeywords: r.exclude_keywords as string[],
          locations: r.locations as string[],
          includeRemote: r.include_remote as boolean,
          sources: r.sources as MarketSource[],
          minScore: r.min_score as number,
        }),
      );
    },

    async listWatchCompanies(orgId) {
      const rows = must(
        await db
          .from("market_watch_companies")
          .select("id, company_name, source, board_token")
          .eq("organization_id", orgId)
          .eq("is_active", true),
        "watch companies",
      ) as Record<string, string>[];
      return rows.map(
        (r): WatchCompany => ({ id: r.id, companyName: r.company_name, source: r.source as WatchCompany["source"], boardToken: r.board_token }),
      );
    },

    async upsertPostings(orgId, postings) {
      const nowIso = new Date().toISOString();
      const out: StoredPosting[] = [];
      // Upsert in chunks; on conflict only refresh last_seen_at and the mutable fields.
      for (let i = 0; i < postings.length; i += 200) {
        const chunk = postings.slice(i, i + 200);
        const rows = must(
          await db
            .from("market_postings")
            .upsert(
              chunk.map((p) => ({
                organization_id: orgId,
                source: p.source,
                external_id: p.externalId,
                dedupe_key: p.dedupeKey,
                title: p.title,
                company_name: p.companyName,
                location: p.location,
                is_remote: p.isRemote,
                employment_type: p.employmentType,
                salary_min: p.salaryMin,
                salary_max: p.salaryMax,
                description_snippet: p.description,
                url: p.url,
                posted_at: p.postedAt,
                last_seen_at: nowIso,
              })),
              { onConflict: "organization_id,source,external_id" },
            )
            .select("id, source, external_id, dedupe_key"),
          "upsert postings",
        ) as { id: string; source: string; external_id: string; dedupe_key: string }[];
        const byKey = new Map(chunk.map((p) => [`${p.source}:${p.externalId}`, p]));
        for (const r of rows) {
          const posting = byKey.get(`${r.source}:${r.external_id}`);
          if (posting) out.push({ id: r.id, dedupeKey: r.dedupe_key, posting });
        }
      }
      return out;
    },

    async matchedDedupeKeys(huntId, keys) {
      if (!keys.length) return new Set();
      const rows = must(
        await db
          .from("market_matches")
          .select("market_postings!inner(dedupe_key)")
          .eq("hunt_id", huntId)
          .in("market_postings.dedupe_key", keys.slice(0, 500)),
        "matched keys",
      ) as { market_postings: { dedupe_key: string } | { dedupe_key: string }[] }[];
      return new Set(rows.flatMap((r) => (Array.isArray(r.market_postings) ? r.market_postings : [r.market_postings]).map((p) => p.dedupe_key)));
    },

    async insertMatches(orgId, rows) {
      const inserted = must(
        await db
          .from("market_matches")
          .upsert(
            rows.map((r) => ({
              organization_id: orgId,
              hunt_id: r.huntId,
              posting_id: r.postingId,
              score: r.score,
              matched_terms: r.matchedTerms,
            })),
            { onConflict: "hunt_id,posting_id", ignoreDuplicates: true },
          )
          .select("id, hunt_id, posting_id"),
        "insert matches",
      ) as { id: string; hunt_id: string; posting_id: string }[];
      return inserted.map((r) => ({ id: r.id, huntId: r.hunt_id, postingId: r.posting_id }));
    },

    async listSubscribers(huntIds) {
      if (!huntIds.length) return [];
      const subs = must(
        await db.from("market_hunt_subscribers").select("hunt_id, user_id").in("hunt_id", huntIds),
        "subscribers",
      ) as { hunt_id: string; user_id: string }[];
      const userIds = [...new Set(subs.map((s) => s.user_id))];
      if (!userIds.length) return [];
      // Only people who are still staff get alerts.
      const [staff, profiles] = await Promise.all([
        db.from("user_roles").select("user_id").in("user_id", userIds).in("role", ["admin", "recruiter"]),
        db.from("profiles").select("id, email").in("id", userIds),
      ]);
      const staffIds = new Set((must(staff, "staff roles") as { user_id: string }[]).map((r) => r.user_id));
      const emails = new Map((must(profiles, "profiles") as { id: string; email: string }[]).map((p) => [p.id, p.email]));
      return subs
        .filter((s) => staffIds.has(s.user_id) && emails.get(s.user_id))
        .map((s) => ({ huntId: s.hunt_id, userId: s.user_id, email: emails.get(s.user_id)! }));
    },

    async markNotified(matchIds) {
      for (let i = 0; i < matchIds.length; i += 200) {
        must(
          await db.from("market_matches").update({ notified_at: new Date().toISOString() }).in("id", matchIds.slice(i, i + 200)),
          "mark notified",
        );
      }
    },

    async touchHunts(huntIds, atIso) {
      must(await db.from("market_hunts").update({ last_scanned_at: atIso }).in("id", huntIds), "touch hunts");
    },

    async logDelivery(orgId, runId, log) {
      must(
        await db.from("notification_deliveries").insert({
          organization_id: orgId,
          channel: log.channel,
          recipient: log.recipient,
          subject: log.subject,
          related_type: "market_scan",
          related_id: runId,
          status: log.status,
          provider_message_id: log.providerMessageId,
          error: log.error,
        }),
        "log delivery",
      );
    },
  };
}
