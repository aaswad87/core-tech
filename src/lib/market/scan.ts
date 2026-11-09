import type { MarketConfig } from "@/lib/market/config";
import { scorePosting } from "@/lib/market/match";
import { type DigestItem, renderDigestEmail, renderSlackMessage, sendEmail, sendSlack } from "@/lib/market/notify";
import {
  adzunaRequest,
  fetchJson,
  greenhouseRequest,
  jsearchRequest,
  leverRequest,
  PARSERS,
  type SourceRequest,
} from "@/lib/market/sources";
import { dedupeKey } from "@/lib/market/text";
import type { Hunt, MarketSource, NormalizedPosting, WatchCompany } from "@/lib/market/types";

/** Per-run limits that bound API cost and scan time. */
export const SCAN_LIMITS = {
  keywordsPerHunt: 5,
  locationsPerHunt: 3,
  queriesPerAggregator: 20,
  careerBoards: 60,
  concurrency: 4,
  minMinutesBetweenRuns: 5,
} as const;

export type StoredPosting = { id: string; dedupeKey: string; posting: NormalizedPosting };
export type Subscriber = { huntId: string; userId: string; email: string };
export type DeliveryLog = {
  channel: "email" | "slack";
  recipient: string;
  subject: string | null;
  status: "sent" | "failed" | "skipped";
  providerMessageId: string | null;
  error: string | null;
};

/** Database access the scan needs. Implemented with the service-role client in repo.ts. */
export interface MarketRepo {
  getOrganizationId(): Promise<string>;
  hasRunSince(orgId: string, sinceIso: string): Promise<boolean>;
  startRun(orgId: string, trigger: "schedule" | "manual", triggeredBy: string | null): Promise<string>;
  finishRun(runId: string, status: "succeeded" | "partial" | "failed", stats: Record<string, number>, errors: ScanError[]): Promise<void>;
  listActiveHunts(orgId: string): Promise<Hunt[]>;
  listWatchCompanies(orgId: string): Promise<WatchCompany[]>;
  upsertPostings(orgId: string, postings: (NormalizedPosting & { dedupeKey: string })[]): Promise<StoredPosting[]>;
  /** Dedupe keys of postings already matched to this hunt (so the same job on another board isn't re-alerted). */
  matchedDedupeKeys(huntId: string, keys: string[]): Promise<Set<string>>;
  /** Inserts matches, ignoring ones that already exist; returns only newly created rows. */
  insertMatches(orgId: string, rows: { huntId: string; postingId: string; score: number; matchedTerms: string[] }[]): Promise<{ id: string; huntId: string; postingId: string }[]>;
  listSubscribers(huntIds: string[]): Promise<Subscriber[]>;
  markNotified(matchIds: string[]): Promise<void>;
  touchHunts(huntIds: string[], atIso: string): Promise<void>;
  logDelivery(orgId: string, runId: string, log: DeliveryLog): Promise<void>;
}

export type ScanError = { source: MarketSource | "scan"; target: string; message: string };

export type ScanResult =
  | { status: "skipped"; reason: string }
  | {
      status: "succeeded" | "partial" | "failed";
      runId: string;
      stats: { requests: number; failedRequests: number; postings: number; newMatches: number; emailsSent: number; slackSent: number };
      errors: ScanError[];
    };

type Job = { source: MarketSource; target: string; request: SourceRequest; companyName: string };

/** Never let a key leak into stored error messages. */
function redact(message: string, config: MarketConfig): string {
  let out = message;
  for (const secret of [config.adzuna?.appKey, config.adzuna?.appId, config.jsearch?.apiKey]) {
    if (secret) out = out.split(secret).join("[redacted]");
  }
  return out.slice(0, 300);
}

export function planRequests(hunts: Hunt[], companies: WatchCompany[], config: MarketConfig): Job[] {
  const jobs: Job[] = [];
  const pairs = (source: MarketSource) => {
    const seen = new Set<string>();
    const out: { keyword: string; location: string }[] = [];
    for (const hunt of hunts.filter((h) => h.sources.includes(source))) {
      const locations = hunt.locations.length ? hunt.locations.slice(0, SCAN_LIMITS.locationsPerHunt) : [""];
      for (const keyword of hunt.keywords.slice(0, SCAN_LIMITS.keywordsPerHunt)) {
        for (const location of locations) {
          const key = `${keyword.toLowerCase()}|${location.toLowerCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push({ keyword, location });
          }
        }
      }
    }
    return out.slice(0, SCAN_LIMITS.queriesPerAggregator);
  };

  if (config.adzuna) {
    const { appId, appKey } = config.adzuna;
    for (const { keyword, location } of pairs("adzuna")) {
      jobs.push({ source: "adzuna", target: `${keyword}${location ? ` in ${location}` : ""}`, companyName: "", request: adzunaRequest({ appId, appKey, what: keyword, where: location || undefined }) });
    }
  }
  if (config.jsearch) {
    for (const { keyword, location } of pairs("jsearch")) {
      const query = `${keyword} jobs in ${location || "USA"}`;
      jobs.push({ source: "jsearch", target: query, companyName: "", request: jsearchRequest({ apiKey: config.jsearch.apiKey, query }) });
    }
  }
  const wanted = new Set(hunts.flatMap((h) => h.sources));
  for (const c of companies.filter((c) => wanted.has(c.source)).slice(0, SCAN_LIMITS.careerBoards)) {
    jobs.push({
      source: c.source,
      target: c.companyName,
      companyName: c.companyName,
      request: c.source === "greenhouse" ? greenhouseRequest(c.boardToken) : leverRequest(c.boardToken),
    });
  }
  return jobs;
}

async function runPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

export async function runMarketScan(deps: {
  repo: MarketRepo;
  config: MarketConfig;
  fetchImpl: typeof fetch;
  appUrl: string;
  trigger: "schedule" | "manual";
  triggeredBy?: string | null;
  now?: () => Date;
}): Promise<ScanResult> {
  const { repo, config, fetchImpl, appUrl } = deps;
  const now = deps.now ?? (() => new Date());
  const orgId = await repo.getOrganizationId();

  const since = new Date(now().getTime() - SCAN_LIMITS.minMinutesBetweenRuns * 60_000).toISOString();
  if (await repo.hasRunSince(orgId, since)) return { status: "skipped", reason: "A scan ran in the last few minutes." };

  const runId = await repo.startRun(orgId, deps.trigger, deps.triggeredBy ?? null);
  const errors: ScanError[] = [];
  const stats = { requests: 0, failedRequests: 0, postings: 0, newMatches: 0, emailsSent: 0, slackSent: 0 };

  try {
    const hunts = await repo.listActiveHunts(orgId);
    const companies = hunts.length ? await repo.listWatchCompanies(orgId) : [];
    const jobs = planRequests(hunts, companies, config);
    stats.requests = jobs.length;

    // 1. Fetch every source; one failing source never stops the others.
    const fetched = await runPool(jobs, SCAN_LIMITS.concurrency, async (job) => {
      try {
        return PARSERS[job.source](await fetchJson(fetchImpl, job.request), job.companyName);
      } catch (e) {
        stats.failedRequests += 1;
        errors.push({ source: job.source, target: job.target, message: redact(e instanceof Error ? e.message : String(e), config) });
        return [];
      }
    });

    // 2. De-duplicate within the run and store.
    const unique = new Map<string, NormalizedPosting & { dedupeKey: string }>();
    for (const p of fetched.flat()) unique.set(`${p.source}:${p.externalId}`, { ...p, dedupeKey: dedupeKey(p) });
    const stored = unique.size ? await repo.upsertPostings(orgId, [...unique.values()]) : [];
    stats.postings = stored.length;

    // 3. Score against each hunt.
    const candidates: { huntId: string; postingId: string; score: number; matchedTerms: string[] }[] = [];
    for (const hunt of hunts) {
      const fits = stored
        .filter((s) => hunt.sources.includes(s.posting.source))
        .map((s) => ({ s, fit: scorePosting(hunt, s.posting) }))
        .filter(({ fit }) => fit.matches);
      if (!fits.length) continue;
      const already = await repo.matchedDedupeKeys(hunt.id, [...new Set(fits.map(({ s }) => s.dedupeKey))]);
      const seenThisRun = new Set<string>();
      for (const { s, fit } of fits.sort((a, b) => b.fit.score - a.fit.score)) {
        if (already.has(s.dedupeKey) || seenThisRun.has(s.dedupeKey)) continue;
        seenThisRun.add(s.dedupeKey);
        candidates.push({ huntId: hunt.id, postingId: s.id, score: fit.score, matchedTerms: fit.matchedTerms });
      }
    }
    const inserted = candidates.length ? await repo.insertMatches(orgId, candidates) : [];
    stats.newMatches = inserted.length;

    // 4. Notify subscribers (one digest per person) and Slack.
    if (inserted.length) {
      const huntById = new Map(hunts.map((h) => [h.id, h]));
      const postingById = new Map(stored.map((s) => [s.id, s.posting]));
      const scoreByKey = new Map(candidates.map((c) => [`${c.huntId}:${c.postingId}`, c]));
      const items: (DigestItem & { huntId: string })[] = inserted.map((m) => {
        const p = postingById.get(m.postingId)!;
        const c = scoreByKey.get(`${m.huntId}:${m.postingId}`)!;
        return {
          matchId: m.id,
          huntId: m.huntId,
          huntName: huntById.get(m.huntId)?.name ?? "Hunt",
          title: p.title,
          companyName: p.companyName,
          location: p.location,
          isRemote: p.isRemote,
          publisher: p.publisher ?? null,
          score: c.score,
          matchedTerms: c.matchedTerms,
        };
      });

      const notified = new Set<string>();
      const subscribers = await repo.listSubscribers([...new Set(items.map((i) => i.huntId))]);
      const byEmail = new Map<string, Set<string>>();
      for (const s of subscribers) byEmail.set(s.email, (byEmail.get(s.email) ?? new Set()).add(s.huntId));

      for (const [email, huntIds] of byEmail) {
        const mine = items.filter((i) => huntIds.has(i.huntId));
        if (!mine.length) continue;
        const { subject, html, text } = renderDigestEmail(mine, appUrl);
        if (!config.email) {
          await repo.logDelivery(orgId, runId, { channel: "email", recipient: email, subject, status: "skipped", providerMessageId: null, error: "Email is not configured (RESEND_API_KEY)" });
          continue;
        }
        const result = await sendEmail(fetchImpl, { ...config.email, to: email, subject, html, text, idempotencyKey: `${runId}:${email}` });
        await repo.logDelivery(orgId, runId, {
          channel: "email",
          recipient: email,
          subject,
          status: result.ok ? "sent" : "failed",
          providerMessageId: result.ok ? result.providerMessageId : null,
          error: result.ok ? null : result.error,
        });
        if (result.ok) {
          stats.emailsSent += 1;
          mine.forEach((i) => notified.add(i.matchId));
        }
      }

      if (config.slackWebhookUrl) {
        const result = await sendSlack(fetchImpl, config.slackWebhookUrl, renderSlackMessage(items, appUrl));
        await repo.logDelivery(orgId, runId, {
          channel: "slack",
          recipient: "slack-webhook",
          subject: null,
          status: result.ok ? "sent" : "failed",
          providerMessageId: null,
          error: result.ok ? null : result.error,
        });
        if (result.ok) {
          stats.slackSent += 1;
          items.forEach((i) => notified.add(i.matchId));
        }
      }

      if (notified.size) await repo.markNotified([...notified]);
    }

    if (hunts.length) await repo.touchHunts(hunts.map((h) => h.id), now().toISOString());

    const status = errors.length === 0 ? "succeeded" : stats.failedRequests < stats.requests ? "partial" : "failed";
    await repo.finishRun(runId, status, stats, errors);
    return { status, runId, stats, errors };
  } catch (e) {
    console.error("Market scan failed", e);
    errors.push({ source: "scan", target: "pipeline", message: redact(e instanceof Error ? e.message : String(e), config) });
    await repo.finishRun(runId, "failed", stats, errors);
    return { status: "failed", runId, stats, errors };
  }
}
