import { BuildingIcon, CalendarIcon, ExternalLinkIcon, MapPinIcon, UsersIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Container } from "@/components/layout/container";
import { MatchActions } from "@/components/market/radar-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/candidates/format";
import { getProfileNames } from "@/lib/candidates/queries";
import { idSchema } from "@/lib/candidates/validation";
import { getMatchDetail, suggestCandidates } from "@/lib/market/queries";
import { SOURCE_SHORT_LABELS } from "@/lib/market/types";

export const metadata: Metadata = { title: "Job Radar match" };

const STATUS_LABELS: Record<string, string> = { new: "New", reviewing: "Reviewing", pursued: "Pursued", dismissed: "Dismissed" };
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default async function MatchDetailPage({ params }: PageProps<"/recruiter/market/[matchId]">) {
  const { matchId } = await params;
  await requireRole(STAFF_ROLES, `/recruiter/market/${matchId}`);
  if (!idSchema.safeParse(matchId).success) notFound();

  const match = await getMatchDetail(matchId);
  const p = match?.market_postings;
  if (!match || !p) notFound();

  const [suggestions, names] = await Promise.all([
    suggestCandidates(match.matched_terms, p.location),
    getProfileNames([match.reviewed_by]),
  ]);
  const salary =
    p.salary_min || p.salary_max
      ? [p.salary_min && money.format(p.salary_min), p.salary_max && money.format(p.salary_max)].filter(Boolean).join(" – ")
      : null;

  return (
    <Container className="py-10">
      <Link href="/recruiter/market" className="text-sm text-muted-foreground hover:text-foreground">
        ← All matches
      </Link>

      <div className="mt-3 grid gap-8 lg:grid-cols-[3fr_2fr]">
        <div className="grid content-start gap-6">
          <header>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-gradient-to-r from-brand to-teal text-white">Fit {match.score}</Badge>
              <Badge variant="secondary">{STATUS_LABELS[match.status] ?? match.status}</Badge>
              <span className="text-sm text-muted-foreground">via {SOURCE_SHORT_LABELS[p.source]}</span>
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-balance text-ink">{p.title}</h1>
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
              {p.company_name && (
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">Company</dt>
                  <BuildingIcon className="size-4" aria-hidden="true" />
                  <dd className="font-medium text-ink">{p.company_name}</dd>
                </div>
              )}
              {(p.location || p.is_remote) && (
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">Location</dt>
                  <MapPinIcon className="size-4" aria-hidden="true" />
                  <dd>{[p.location, p.is_remote ? "Remote" : null].filter(Boolean).join(" · ")}</dd>
                </div>
              )}
              {p.posted_at && (
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">Posted</dt>
                  <CalendarIcon className="size-4" aria-hidden="true" />
                  <dd>Posted {formatDateTime(p.posted_at)}</dd>
                </div>
              )}
              {salary && (
                <div>
                  <dt className="sr-only">Salary</dt>
                  <dd>{salary}</dd>
                </div>
              )}
              {p.employment_type && (
                <div>
                  <dt className="sr-only">Employment type</dt>
                  <dd>{p.employment_type}</dd>
                </div>
              )}
            </dl>
          </header>

          <section aria-labelledby="why-heading" className="rounded-2xl border border-border bg-background p-5">
            <h2 id="why-heading" className="font-semibold text-ink">
              Why it matched “{match.market_hunts?.name ?? "hunt"}”
            </h2>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {match.matched_terms.map((t) => (
                <li key={t} className="rounded-full bg-brand-50 px-2.5 py-1 text-sm font-medium text-brand-700">
                  {t}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Title keyword = 3 points, description keyword = 1 point. Found {formatDateTime(match.created_at)}
              {match.notified_at ? `; alert sent ${formatDateTime(match.notified_at)}` : "; no alert sent yet"}.
            </p>
          </section>

          <section aria-labelledby="desc-heading" className="rounded-2xl border border-border bg-background p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="desc-heading" className="font-semibold text-ink">
                Posting summary
              </h2>
              <Button asChild variant="outline" size="sm" className="rounded-full">
                <a href={p.url} target="_blank" rel="noopener noreferrer nofollow">
                  Open original posting <ExternalLinkIcon aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </Button>
            </div>
            {p.description_snippet ? (
              // Plain text from an external source — never rendered as HTML.
              <p className="mt-3 text-sm leading-relaxed whitespace-pre-line text-foreground">{p.description_snippet}</p>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">The source didn&apos;t include a description. Open the original posting for details.</p>
            )}
          </section>
        </div>

        <aside className="grid content-start gap-6">
          <section aria-labelledby="next-heading" className="rounded-2xl border border-brand/20 bg-brand-50/60 p-5">
            <h2 id="next-heading" className="font-semibold text-ink">
              Next step
            </h2>
            <p className="mt-1 mb-4 text-sm text-muted-foreground">
              Pursuing saves the company and an internal draft job so the team can track this opportunity. Nothing is sent
              to the employer or to candidates.
            </p>
            <MatchActions matchId={match.id} status={match.status} pursued={Boolean(match.pursued_job_id)} />
            {match.pursued_job_id && (
              <div className="mt-3 grid gap-2">
                <p className="text-sm text-success">Company and draft job saved.</p>
                <Button asChild className="h-10 rounded-full">
                  <Link href={`/recruiter/jobs/${match.pursued_job_id}`}>Open the job and its pipeline</Link>
                </Button>
              </div>
            )}
            {match.reviewed_by && match.reviewed_at && (
              <p className="mt-3 text-xs text-muted-foreground">
                Last updated by {names.get(match.reviewed_by) ?? "a team member"} on {formatDateTime(match.reviewed_at)}
              </p>
            )}
          </section>

          <section aria-labelledby="cands-heading" className="rounded-2xl border border-border bg-background p-5">
            <h2 id="cands-heading" className="flex items-center gap-2 font-semibold text-ink">
              <UsersIcon className="size-4" aria-hidden="true" /> Candidates to consider
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              From your candidate database, based on the matched skills. Review each profile — suggestions are not
              rankings or hiring decisions.
            </p>
            {suggestions.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No candidates in the database mention these skills yet.{" "}
                <Link href="/recruiter/candidates/new" className="text-brand hover:underline">
                  Add a candidate
                </Link>
                .
              </p>
            ) : (
              <ul className="mt-4 grid gap-3">
                {suggestions.map((c) => (
                  <li key={c.id} className="rounded-xl border border-border p-3">
                    <Link href={`/recruiter/candidates/${c.id}`} className="font-medium text-brand hover:underline">
                      {c.name}
                    </Link>
                    {c.headline && <p className="text-sm">{c.headline}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Mentions: {c.matchedTerms.join(", ")}
                      {c.location && ` · ${c.location}`}
                      {c.sameArea && " · same area"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {match.matched_terms.slice(0, 4).map((t) => (
                <Button key={t} asChild variant="outline" size="sm" className="rounded-full">
                  <Link href={`/recruiter/candidates?q=${encodeURIComponent(t)}`}>Search “{t}”</Link>
                </Button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </Container>
  );
}
