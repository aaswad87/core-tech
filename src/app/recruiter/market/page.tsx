import { BuildingIcon, ExternalLinkIcon, MapPinIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { RunScanButton } from "@/components/market/radar-forms";
import { RadarSetupPanel, RadarTabs } from "@/components/market/radar-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/candidates/format";
import { isLeadCaptureConfigured } from "@/lib/env.server";
import { getLastRun, listHunts, listMatches, MATCHES_PAGE_SIZE } from "@/lib/market/queries";
import { SOURCE_SHORT_LABELS } from "@/lib/market/types";
import { cn } from "@/lib/utils";
import { z } from "zod";

export const metadata: Metadata = { title: "Job Radar" };

const STATUSES = [
  { value: "new", label: "New" },
  { value: "reviewing", label: "Reviewing" },
  { value: "pursued", label: "Pursued" },
  { value: "dismissed", label: "Dismissed" },
] as const;

const RUN_STATUS: Record<string, string> = {
  running: "Running",
  succeeded: "Completed",
  partial: "Completed with source errors",
  failed: "Failed",
};

function href(status: string, hunt: string | null, page = 1) {
  const p = new URLSearchParams();
  if (status !== "new") p.set("status", status);
  if (hunt) p.set("hunt", hunt);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  return qs ? `/recruiter/market?${qs}` : "/recruiter/market";
}

export default async function MarketInboxPage({ searchParams }: PageProps<"/recruiter/market">) {
  await requireRole(STAFF_ROLES, "/recruiter/market");
  const params = await searchParams;
  const status = STATUSES.some((s) => s.value === params.status) ? (params.status as string) : "new";
  const huntId = z.uuid().safeParse(params.hunt).success ? (params.hunt as string) : null;
  const pageNum = Number.parseInt(typeof params.page === "string" ? params.page : "1", 10);
  const page = Number.isFinite(pageNum) ? Math.min(Math.max(pageNum, 1), 500) : 1;

  const [{ items, total }, hunts, lastRun] = await Promise.all([listMatches({ status, huntId, page }), listHunts(), getLastRun()]);
  const pageCount = Math.max(1, Math.ceil(total / MATCHES_PAGE_SIZE));
  const canScan = isLeadCaptureConfigured();

  return (
    <Container className="py-10">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-ink">Job Radar</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            New job postings from Indeed, Dice, company career sites and more that fit your saved hunts. Review each one,
            then pursue it to save the company and start finding candidates.
          </p>
        </div>
        <RunScanButton disabled={!canScan || hunts.length === 0} disabledReason={!canScan ? "Needs SUPABASE_SECRET_KEY" : hunts.length === 0 ? "Create a hunt first" : undefined} />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <RadarTabs />
        {lastRun && (
          <p className="text-sm text-muted-foreground">
            Last scan: {formatDateTime(lastRun.started_at)} · {RUN_STATUS[lastRun.status] ?? lastRun.status}
            {lastRun.stats?.newMatches !== undefined && ` · ${lastRun.stats.newMatches} new`}
          </p>
        )}
      </div>

      {lastRun && lastRun.errors?.length > 0 && (
        <details className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <summary className="cursor-pointer font-medium">{lastRun.errors.length} source {lastRun.errors.length === 1 ? "error" : "errors"} in the last scan</summary>
          <ul className="mt-2 grid gap-1">
            {lastRun.errors.slice(0, 20).map((e, i) => (
              <li key={i}>
                {e.source} · {e.target}: {e.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {hunts.length === 0 ? (
        <section className="mt-8 rounded-3xl border border-dashed border-brand/30 bg-brand-50/50 p-8">
          <h2 className="text-xl font-semibold text-ink">Set up your first hunt</h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            A hunt describes the roles you want to hear about — keywords like &quot;network engineer&quot; or &quot;SOC
            analyst&quot;, locations like Texas, and which sources to watch.
          </p>
          <Button asChild className="mt-5 h-10 rounded-full px-5">
            <Link href="/recruiter/market/hunts/new">Create a hunt</Link>
          </Button>
          <div className="mt-8">
            <h3 className="mb-3 text-sm font-semibold text-ink">Connection status</h3>
            <RadarSetupPanel />
          </div>
        </section>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {STATUSES.map((s) => (
              <Link
                key={s.value}
                href={href(s.value, huntId)}
                aria-current={s.value === status ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-full border px-3 text-sm",
                  s.value === status ? "border-night bg-night text-white" : "border-border bg-background hover:bg-muted",
                )}
              >
                {s.label}
              </Link>
            ))}
            <form action="/recruiter/market" className="ml-auto flex items-center gap-2">
              {status !== "new" && <input type="hidden" name="status" value={status} />}
              <label htmlFor="hunt-filter" className="text-sm text-muted-foreground">
                Hunt
              </label>
              <select id="hunt-filter" name="hunt" defaultValue={huntId ?? ""} className="h-8 rounded-lg border border-input bg-background px-2 text-sm">
                <option value="">All hunts</option>
                {hunts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="outline" size="sm">
                Filter
              </Button>
            </form>
          </div>

          {items.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-border bg-background p-10 text-center text-muted-foreground">
              {status === "new" ? "No new matches. Run a scan, or wait for the next scheduled one." : "Nothing here yet."}
            </div>
          ) : (
            <ul className="mt-6 grid gap-3">
              {items.map((m) => (
                <li key={m.id}>
                  <article className="relative grid gap-3 rounded-2xl border border-border bg-background p-5 transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:border-brand/40 md:grid-cols-[1fr_auto]">
                    <div>
                      <h2 className="text-lg font-semibold text-ink">
                        <Link href={`/recruiter/market/${m.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
                          {m.posting.title}
                        </Link>
                      </h2>
                      <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        {m.posting.companyName && (
                          <span className="flex items-center gap-1">
                            <BuildingIcon className="size-4" aria-hidden="true" /> {m.posting.companyName}
                          </span>
                        )}
                        {(m.posting.location || m.posting.isRemote) && (
                          <span className="flex items-center gap-1">
                            <MapPinIcon className="size-4" aria-hidden="true" />
                            {[m.posting.location, m.posting.isRemote ? "Remote" : null].filter(Boolean).join(" · ")}
                          </span>
                        )}
                        <span>{SOURCE_SHORT_LABELS[m.posting.source]}</span>
                        <span>Found {formatDateTime(m.createdAt)}</span>
                      </p>
                      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Matched keywords">
                        {m.matchedTerms.map((t) => (
                          <li key={t} className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                            {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex items-start gap-3 md:flex-col md:items-end">
                      <Badge className="bg-gradient-to-r from-brand-400 to-teal font-semibold text-night">Fit {m.score}</Badge>
                      <span className="text-xs text-muted-foreground">{m.huntName}</span>
                      <a
                        href={m.posting.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="relative z-10 inline-flex items-center gap-1 text-xs text-brand hover:underline"
                      >
                        Original posting <ExternalLinkIcon className="size-3" aria-hidden="true" />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}

          {pageCount > 1 && (
            <nav aria-label="Match pages" className="mt-6 flex items-center justify-between">
              {page > 1 ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={href(status, huntId, page - 1)}>Previous</Link>
                </Button>
              ) : (
                <span />
              )}
              <span className="text-sm text-muted-foreground">
                Page {page} of {pageCount}
              </span>
              {page < pageCount ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={href(status, huntId, page + 1)}>Next</Link>
                </Button>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </Container>
  );
}
