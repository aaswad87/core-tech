import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, SearchIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { formatDateTime, fullName } from "@/lib/candidates/format";
import { getStaffMembers } from "@/lib/candidates/queries";
import {
  CANDIDATES_PAGE_SIZE,
  type CandidateSearch,
  candidatesHref,
  parseCandidateSearch,
  toSearchRpcArgs,
} from "@/lib/candidates/search";
import type { CandidateListRow } from "@/lib/candidates/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Candidates" };

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function Filters({ search, staff }: { search: CandidateSearch; staff: { id: string; name: string }[] }) {
  return (
    <form role="search" action="/recruiter/candidates" className="grid gap-3 rounded-xl border border-border bg-background p-4 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
      <div className="grid gap-1">
        <label htmlFor="cand-q" className="text-xs font-medium text-muted-foreground">Search</label>
        <input id="cand-q" name="q" type="search" maxLength={100} defaultValue={search.query} placeholder="Name, email, headline, location, skill" className={inputClass} />
      </div>
      <div className="grid gap-1">
        <label htmlFor="cand-owner" className="text-xs font-medium text-muted-foreground">Owner</label>
        <select id="cand-owner" name="owner" defaultValue={search.owner} className={inputClass}>
          <option value="any">Anyone</option>
          <option value="me">Me</option>
          <option value="unowned">Unassigned</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <div className="grid gap-1">
        <label htmlFor="cand-skill" className="text-xs font-medium text-muted-foreground">Skill (exact)</label>
        <input id="cand-skill" name="skill" maxLength={80} defaultValue={search.skill} placeholder="e.g. BGP" className={inputClass} />
      </div>
      <div className="grid gap-1">
        <label htmlFor="cand-tag" className="text-xs font-medium text-muted-foreground">Tag</label>
        <input id="cand-tag" name="tag" maxLength={40} defaultValue={search.tag} placeholder="e.g. ccnp" className={inputClass} />
      </div>
      <Button type="submit" className="h-9 self-end">
        <SearchIcon aria-hidden="true" /> Search
      </Button>
    </form>
  );
}

export default async function CandidatesPage({ searchParams }: PageProps<"/recruiter/candidates">) {
  const user = await requireRole(STAFF_ROLES, "/recruiter/candidates");
  const search = parseCandidateSearch(await searchParams);

  const supabase = await createClient();
  const [{ data, error }, staff] = await Promise.all([
    supabase.rpc("search_candidates", toSearchRpcArgs(search, user.id)),
    getStaffMembers(),
  ]);

  const rows = (data ?? []) as CandidateListRow[];
  const total = Number(rows[0]?.total_count ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / CANDIDATES_PAGE_SIZE));
  const staffNames = new Map(staff.map((s) => [s.id, s.name]));
  const filtered = Boolean(search.query || search.tag || search.skill || search.owner !== "any");

  return (
    <Container className="py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Candidates</h1>
        <Button asChild size="lg" className="h-10 px-4">
          <Link href="/recruiter/candidates/new">
            <PlusIcon aria-hidden="true" /> Add candidate
          </Link>
        </Button>
      </div>

      <div className="mt-6">
        <Filters search={search} staff={staff} />
      </div>

      <div className="mt-6" aria-live="polite">
        {error ? (
          <p role="alert" className="text-destructive">Candidates could not be loaded. Please refresh the page.</p>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-background p-10 text-center">
            <p className="text-lg font-medium text-ink">{filtered ? "No candidates match these filters." : "No candidates yet."}</p>
            <p className="mt-2 text-muted-foreground">
              {filtered ? (
                <Link href="/recruiter/candidates" className="text-primary underline underline-offset-4">Clear filters</Link>
              ) : (
                <Link href="/recruiter/candidates/new" className="text-primary underline underline-offset-4">Add the first candidate</Link>
              )}
            </p>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              {total} {total === 1 ? "candidate" : "candidates"}
            </p>
            <ul className="grid gap-3">
              {rows.map((c) => (
                <li key={c.id}>
                  <article className="relative grid gap-2 rounded-xl border border-border bg-background p-4 focus-within:ring-3 focus-within:ring-ring/50 hover:border-brand/50 md:grid-cols-[2fr_2fr_1fr]">
                    <div>
                      <h2 className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                        <Link href={`/recruiter/candidates/${c.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
                          {fullName(c)}
                        </Link>
                        {c.is_demo && <Badge variant="outline">Demo</Badge>}
                      </h2>
                      {c.headline && <p className="text-sm text-foreground">{c.headline}</p>}
                      <p className="text-sm text-muted-foreground">{[c.location, c.email].filter(Boolean).join(" · ")}</p>
                    </div>
                    <div className="flex flex-wrap content-start gap-1.5">
                      {c.skills.slice(0, 6).map((s) => (
                        <span key={s} className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">{s}</span>
                      ))}
                      {c.skills.length > 6 && <span className="text-xs text-muted-foreground">+{c.skills.length - 6} more</span>}
                      {c.tags.map((t) => (
                        <span key={t} className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">#{t}</span>
                      ))}
                    </div>
                    <div className="text-sm text-muted-foreground md:text-right">
                      <p>{c.owner_id ? staffNames.get(c.owner_id) ?? "Unknown owner" : "Unassigned"}</p>
                      <p className="text-xs">Updated {formatDateTime(c.updated_at)}</p>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
            {pageCount > 1 && (
              <nav aria-label="Candidate pages" className="mt-6 flex items-center justify-between">
                {search.page > 1 ? (
                  <Button asChild variant="outline" className="h-9">
                    <Link href={candidatesHref(search, { page: search.page - 1 })} rel="prev"><ChevronLeftIcon aria-hidden="true" /> Previous</Link>
                  </Button>
                ) : <span />}
                <p className="text-sm text-muted-foreground">Page {search.page} of {pageCount}</p>
                {search.page < pageCount ? (
                  <Button asChild variant="outline" className="h-9">
                    <Link href={candidatesHref(search, { page: search.page + 1 })} rel="next">Next <ChevronRightIcon aria-hidden="true" /></Link>
                  </Button>
                ) : <span />}
              </nav>
            )}
          </>
        )}
      </div>
    </Container>
  );
}
