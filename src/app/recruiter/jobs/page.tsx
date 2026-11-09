import { KanbanSquareIcon, MapPinIcon, PlusIcon, SearchIcon, UsersIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/candidates/format";
import { JOBS_PAGE_SIZE, listStaffJobs } from "@/lib/jobs/staff-queries";
import { JOB_STATUS_TONES, JOB_STATUSES, jobStatusLabel } from "@/lib/jobs/validation";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Jobs" };

const FILTERS = [{ value: "open", label: "Open" }, ...JOB_STATUSES, { value: "all", label: "All" }];

function href(status: string, query: string, page = 1) {
  const p = new URLSearchParams();
  if (status !== "open") p.set("status", status);
  if (query) p.set("q", query);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  return qs ? `/recruiter/jobs?${qs}` : "/recruiter/jobs";
}

export default async function StaffJobsPage({ searchParams }: PageProps<"/recruiter/jobs">) {
  await requireRole(STAFF_ROLES, "/recruiter/jobs");
  const params = await searchParams;
  const status = FILTERS.some((f) => f.value === params.status) ? (params.status as string) : "open";
  const query = (typeof params.q === "string" ? params.q : "").trim().slice(0, 100);
  const pageNum = Number.parseInt(typeof params.page === "string" ? params.page : "1", 10);
  const page = Number.isFinite(pageNum) ? Math.min(Math.max(pageNum, 1), 400) : 1;

  const { jobs, total, counts } = await listStaffJobs({ status, query, page });
  const pageCount = Math.max(1, Math.ceil(total / JOBS_PAGE_SIZE));

  return (
    <Container className="py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-ink">Jobs</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline" className="h-10 rounded-full px-4">
            <Link href="/recruiter/pipeline">
              <KanbanSquareIcon aria-hidden="true" /> Pipeline
            </Link>
          </Button>
          <Button asChild className="h-10 rounded-full px-4">
            <Link href="/recruiter/jobs/new">
              <PlusIcon aria-hidden="true" /> New job
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={href(f.value, query)}
            aria-current={f.value === status ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center rounded-full border px-3 text-sm",
              f.value === status ? "border-night bg-night text-white" : "border-border bg-background hover:bg-muted",
            )}
          >
            {f.label}
          </Link>
        ))}
        <form role="search" action="/recruiter/jobs" className="ml-auto flex gap-2">
          {status !== "open" && <input type="hidden" name="status" value={status} />}
          <label htmlFor="job-search" className="sr-only">
            Search jobs by title
          </label>
          <input id="job-search" name="q" type="search" defaultValue={query} placeholder="Search titles" className="h-8 w-52 rounded-lg border border-input bg-background px-3 text-sm" />
          <Button type="submit" variant="outline" size="sm">
            <SearchIcon aria-hidden="true" /> Search
          </Button>
        </form>
      </div>

      {jobs.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border bg-background p-10 text-center text-muted-foreground">
          {query || status !== "open" ? "No jobs match these filters." : "No open jobs yet."}{" "}
          <Link href="/recruiter/jobs/new" className="text-brand hover:underline">
            Create a job
          </Link>
          .
        </div>
      ) : (
        <ul className="mt-6 grid gap-3">
          {jobs.map((j) => (
            <li key={j.id}>
              <article className="relative grid gap-2 rounded-2xl border border-border bg-background p-5 focus-within:ring-3 focus-within:ring-ring/50 hover:border-brand/40 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-ink">
                    <Link href={`/recruiter/jobs/${j.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
                      {j.title}
                    </Link>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", JOB_STATUS_TONES[j.status])}>{jobStatusLabel(j.status)}</span>
                    {j.is_demo && <Badge variant="outline">Demo</Badge>}
                  </h2>
                  <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span>{j.companies?.name ?? "No company"}</span>
                    {j.location && (
                      <span className="flex items-center gap-1">
                        <MapPinIcon className="size-4" aria-hidden="true" /> {j.location}
                      </span>
                    )}
                    <span>Updated {formatDateTime(j.updated_at)}</span>
                  </p>
                </div>
                <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <UsersIcon className="size-4 text-brand" aria-hidden="true" /> {counts.get(j.id) ?? 0} active
                </p>
              </article>
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <nav aria-label="Job pages" className="mt-6 flex items-center justify-between">
          {page > 1 ? <Button asChild variant="outline" size="sm"><Link href={href(status, query, page - 1)}>Previous</Link></Button> : <span />}
          <span className="text-sm text-muted-foreground">Page {page} of {pageCount}</span>
          {page < pageCount ? <Button asChild variant="outline" size="sm"><Link href={href(status, query, page + 1)}>Next</Link></Button> : <span />}
        </nav>
      )}
    </Container>
  );
}
