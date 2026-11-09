import { ChevronLeftIcon, ChevronRightIcon, InfoIcon, SearchIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { JobMeta } from "@/components/jobs/job-meta";
import { Container } from "@/components/layout/container";
import { PageHero } from "@/components/marketing/page-hero";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  type JobSearch,
  jobsHref,
  listPublishedJobs,
  parseJobSearch,
  WORK_ARRANGEMENTS,
} from "@/lib/jobs/public-jobs";
import { pageMetadata } from "@/lib/seo";
import { photos } from "@/content/photos";

export async function generateMetadata({ searchParams }: PageProps<"/jobs">): Promise<Metadata> {
  const search = parseJobSearch(await searchParams);
  const filtered = Boolean(search.query || search.arrangement || search.page > 1);
  return pageMetadata({
    title: "Open Jobs",
    description: "Open network, cybersecurity, cloud, telecom, and IT infrastructure jobs from CoreTech Recruiting.",
    path: "/jobs",
    // Index the main board only, not every filter/page combination.
    noIndex: filtered,
  });
}

function SearchForm({ search }: { search: JobSearch }) {
  return (
    <form role="search" action="/jobs" className="grid gap-3 rounded-xl border border-border bg-background p-4 sm:grid-cols-[1fr_12rem_auto]">
      <div className="grid gap-1.5">
        <label htmlFor="job-q" className="text-sm font-medium">
          Keyword or location
        </label>
        <input
          id="job-q"
          name="q"
          type="search"
          maxLength={100}
          defaultValue={search.query}
          placeholder="e.g. network engineer, Dallas"
          className="h-10 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="job-arrangement" className="text-sm font-medium">
          Work arrangement
        </label>
        <select
          id="job-arrangement"
          name="arrangement"
          defaultValue={search.arrangement ?? ""}
          className="h-10 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        >
          <option value="">Any</option>
          {WORK_ARRANGEMENTS.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" size="lg" className="h-10 self-end px-5">
        <SearchIcon aria-hidden="true" />
        Search
      </Button>
    </form>
  );
}

function Pagination({ search, pageCount }: { search: JobSearch; pageCount: number }) {
  if (pageCount <= 1) return null;
  const prev = search.page > 1 ? jobsHref(search, { page: search.page - 1 }) : null;
  const next = search.page < pageCount ? jobsHref(search, { page: search.page + 1 }) : null;

  return (
    <nav aria-label="Job results pages" className="mt-8 flex items-center justify-between gap-4">
      {prev ? (
        <Button asChild variant="outline" className="h-9">
          <Link href={prev} rel="prev">
            <ChevronLeftIcon aria-hidden="true" /> Previous
          </Link>
        </Button>
      ) : (
        <span />
      )}
      <p className="text-sm text-muted-foreground">
        Page {search.page} of {pageCount}
      </p>
      {next ? (
        <Button asChild variant="outline" className="h-9">
          <Link href={next} rel="next">
            Next <ChevronRightIcon aria-hidden="true" />
          </Link>
        </Button>
      ) : (
        <span />
      )}
    </nav>
  );
}

export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  const search = parseJobSearch(await searchParams);
  const result = await listPublishedJobs(search);
  const filtered = Boolean(search.query || search.arrangement);

  return (
    <>
      <PageHero
        photo={photos.engineerMonitors}
        eyebrow="Job board"
        title="Open technical jobs"
        intro="Browse current openings. Don't see the right fit? Tell a recruiter what you're looking for."
        breadcrumbs={[{ title: "Jobs", href: "/jobs" }]}
      />

      <Container className="py-12">
        {result.status === "unconfigured" ? (
          <Alert>
            <InfoIcon />
            <AlertTitle>Job listings aren&apos;t available yet</AlertTitle>
            <AlertDescription>
              Our job board is being set up. In the meantime, you can{" "}
              <Link href="/candidates#talk-to-a-recruiter" className="text-primary underline underline-offset-4">
                tell a recruiter what you&apos;re looking for
              </Link>
              .
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <SearchForm search={search} />

            <div className="mt-8" aria-live="polite">
              {result.status === "error" ? (
                <p role="alert" className="text-destructive">
                  Job listings couldn&apos;t be loaded right now. Please refresh the page or try again later.
                </p>
              ) : result.jobs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-10 text-center">
                  <p className="text-lg font-medium text-ink">
                    {filtered ? "No jobs match your search." : "There are no open jobs posted right now."}
                  </p>
                  <p className="mt-2 text-muted-foreground">
                    {filtered ? (
                      <Link href="/jobs" className="text-primary underline underline-offset-4">
                        Clear filters
                      </Link>
                    ) : (
                      <>
                        New roles are added regularly.{" "}
                        <Link href="/candidates#talk-to-a-recruiter" className="text-primary underline underline-offset-4">
                          Tell a recruiter what you&apos;re looking for
                        </Link>
                        .
                      </>
                    )}
                  </p>
                </div>
              ) : (
                <>
                  <p className="mb-4 text-sm text-muted-foreground">
                    {result.total} {result.total === 1 ? "job" : "jobs"} found
                  </p>
                  <ul className="grid gap-4">
                    {result.jobs.map((job) => (
                      <li key={job.id}>
                        <article className="relative rounded-xl border border-border bg-card p-6 transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:border-brand/50">
                          <h2 className="text-lg font-semibold text-ink">
                            <Link href={`/jobs/${job.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
                              {job.title}
                            </Link>
                          </h2>
                          <JobMeta job={job} className="mt-2 text-muted-foreground" />
                          {job.public_summary && <p className="mt-3 line-clamp-3 text-foreground">{job.public_summary}</p>}
                        </article>
                      </li>
                    ))}
                  </ul>
                  <Pagination search={search} pageCount={result.pageCount} />
                </>
              )}
            </div>
          </>
        )}
      </Container>
    </>
  );
}
