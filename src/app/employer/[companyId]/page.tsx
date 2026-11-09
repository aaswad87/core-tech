import { FileTextIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCompanyOverview } from "@/lib/employer/queries";
import { OPEN_SUBMISSION_STATUSES, SUBMISSION_STATUS_LABELS } from "@/lib/employer/validation";
import { EMPLOYMENT_TYPES, JOB_STATUS_TONES, jobStatusLabel, WORK_ARRANGEMENT_OPTIONS } from "@/lib/jobs/validation";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Jobs & candidates" };

const submittedDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Chicago" });
const label = (list: readonly { value: string; label: string }[], value: string | null) => list.find((o) => o.value === value)?.label;

// Membership is checked by the layout; RLS limits every query to this company anyway.
export default async function EmployerCompanyPage({ params }: PageProps<"/employer/[companyId]">) {
  const { companyId } = await params;
  const { jobs, submissions, pendingRequestCount, error } = await getCompanyOverview(companyId);
  const jobTitles = new Map(jobs.map((j) => [j.id, j.title]));
  const open = submissions.filter((s) => OPEN_SUBMISSION_STATUSES.includes(s.status));
  const closed = submissions.filter((s) => !OPEN_SUBMISSION_STATUSES.includes(s.status));

  return (
    <Container className="grid gap-6 py-8">
      {error && <p role="alert" className="text-sm text-destructive">Some information couldn&apos;t be loaded. Please refresh the page.</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Candidates submitted to you ({open.length} open)</CardTitle>
          <CardDescription>Each candidate agreed to be shared with you for that specific role.</CardDescription>
        </CardHeader>
        <CardContent>
          {submissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No candidates yet. Your recruiter will submit candidates here as they find strong matches.</p>
          ) : (
            <div className="grid gap-6">
              {[
                { title: "Open", rows: open },
                { title: "Closed", rows: closed },
              ]
                .filter((g) => g.rows.length > 0)
                .map((group) => (
                  <section key={group.title} aria-label={`${group.title} submissions`}>
                    <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{group.title}</h2>
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {group.rows.map((s) => (
                        <li key={s.id}>
                          <Link
                            href={`/employer/${companyId}/candidates/${s.id}`}
                            className="flex flex-wrap items-center justify-between gap-3 p-3 hover:bg-muted/50"
                          >
                            <div>
                              <p className="font-medium text-ink">{s.candidate_display_name}</p>
                              <p className="text-xs text-muted-foreground">
                                {jobTitles.get(s.job_id) ?? "Job"} · submitted {submittedDate.format(new Date(s.created_at))}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {s.shared_resume_id && OPEN_SUBMISSION_STATUSES.includes(s.status) && (
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <FileTextIcon className="size-3.5" aria-hidden="true" /> Resume
                                </span>
                              )}
                              <Badge variant={s.status === "submitted" ? "default" : "outline"}>{SUBMISSION_STATUS_LABELS[s.status] ?? s.status}</Badge>
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1.5">
            <CardTitle className="text-lg">Your jobs</CardTitle>
            <CardDescription>
              Roles CoreTech is recruiting for you.
              {pendingRequestCount > 0 && ` ${pendingRequestCount} request${pendingRequestCount === 1 ? "" : "s"} waiting for review.`}
            </CardDescription>
          </div>
          <Button asChild size="sm">
            <Link href={`/employer/${companyId}/requests`}>Request a new job</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs yet. Send a job request and your recruiter will set it up.</p>
          ) : (
            <ul className="divide-y divide-border">
              {jobs.map((j) => {
                const count = submissions.filter((s) => s.job_id === j.id).length;
                return (
                  <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-medium text-ink">{j.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {[j.location, label(WORK_ARRANGEMENT_OPTIONS, j.work_arrangement), label(EMPLOYMENT_TYPES, j.employment_type)]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {count} candidate{count === 1 ? "" : "s"}
                      </span>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", JOB_STATUS_TONES[j.status])}>{jobStatusLabel(j.status)}</span>
                      {j.status === "published" && (
                        <Link href={`/jobs/${j.id}`} className="text-xs text-brand hover:underline">
                          Public listing
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
