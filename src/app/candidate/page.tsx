import { CircleCheckIcon, CircleIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { WithdrawButton } from "@/components/jobs/apply-controls";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { profileChecklist } from "@/lib/candidates/portal";
import { loadMyApplications, loadMyInterviews, loadMyPortal } from "@/lib/candidates/portal-queries";
import { formatInZone, INTERVIEW_FORMATS } from "@/lib/employer/validation";
import { hasStarted, INTERVIEW_STATUS, labelOf } from "@/lib/interviews/validation";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Overview" };

const appliedDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Chicago" });

export default async function CandidateOverviewPage() {
  const user = await requireRole(["candidate"], "/candidate");
  const supabase = await createClient();
  const [portal, { applications, error: applicationsError }, { interviews }] = await Promise.all([
    loadMyPortal(supabase, user.id),
    loadMyApplications(supabase),
    loadMyInterviews(supabase),
  ]);
  const upcoming = interviews.filter((i) => i.status === "scheduled" && !hasStarted(i.starts_at, -60)).reverse();
  const recent = interviews.filter((i) => !upcoming.includes(i)).slice(0, 5);

  const checklist = profileChecklist({
    hasName: Boolean(portal.profile.firstName && portal.profile.lastName),
    phone: portal.profile.phone,
    location: portal.profile.location,
    headline: portal.profile.headline,
    summary: portal.profile.summary,
    resumeCount: portal.resumes.length,
    hasPreferences: portal.hasPreferences,
  });
  const done = checklist.filter((c) => c.done).length;
  const percent = Math.round((done / checklist.length) * 100);

  return (
    <Container className="max-w-4xl py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">
        {portal.profile.firstName ? `Welcome, ${portal.profile.firstName}` : "Welcome"}
      </h1>
      <p className="mt-2 text-muted-foreground">Keep your profile current so our recruiters can match you with the right roles.</p>

      {interviews.length > 0 && (
        <Card className="mt-8 border-brand/30">
          <CardHeader>
            <CardTitle className="text-lg">Your interviews</CardTitle>
            <CardDescription>Times are shown in the interview&apos;s time zone. Contact your recruiter if you need to change one.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {[...upcoming, ...recent].map((i) => (
                <li key={i.id} className="grid gap-1 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink">
                      {i.job_title}
                      {i.company_name && <span className="text-muted-foreground"> · {i.company_name}</span>}
                    </span>
                    <Badge variant={upcoming.includes(i) ? "secondary" : "outline"}>{labelOf(INTERVIEW_STATUS, i.status)}</Badge>
                  </div>
                  <p className="text-sm">
                    {formatInZone(i.starts_at, i.timezone)} · {i.duration_minutes} min · {labelOf(INTERVIEW_FORMATS, i.format)}
                  </p>
                  {upcoming.includes(i) && i.meeting_url && (
                    <a href={i.meeting_url} target="_blank" rel="noreferrer noopener" className="text-sm break-all text-brand hover:underline">
                      Join: {i.meeting_url}
                    </a>
                  )}
                  {upcoming.includes(i) && i.location && <p className="text-sm">Address: {i.location}</p>}
                  {upcoming.includes(i) && i.instructions && <p className="text-sm whitespace-pre-line text-muted-foreground">{i.instructions}</p>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="mt-8 grid gap-6 md:grid-cols-[1fr_18rem]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your applications</CardTitle>
            <CardDescription>Jobs you&apos;ve applied to through this site.</CardDescription>
          </CardHeader>
          <CardContent>
            {applicationsError ? (
              <p role="alert" className="text-sm text-destructive">Your applications couldn&apos;t be loaded. Please refresh the page.</p>
            ) : applications.length === 0 ? (
              <div className="grid gap-3">
                <p className="text-sm text-muted-foreground">You haven&apos;t applied to any jobs yet.</p>
                <div>
                  <Button asChild size="sm">
                    <Link href="/jobs">Browse open jobs</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {applications.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      {a.job_is_open ? (
                        <Link href={`/jobs/${a.job_id}`} className="font-medium text-ink hover:text-brand hover:underline">
                          {a.job_title}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink">{a.job_title}</span>
                      )}
                      <p className="text-xs text-muted-foreground">Applied {appliedDate.format(new Date(a.applied_at))}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={a.status_label === "In progress" ? "secondary" : "outline"}>{a.status_label}</Badge>
                      {a.can_withdraw && <WithdrawButton applicationId={a.id} jobTitle={a.job_title} />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Profile {percent}% complete</CardTitle>
            <CardDescription>
              {done === checklist.length ? "Everything's filled in." : `${checklist.length - done} item${checklist.length - done === 1 ? "" : "s"} left.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completeness">
              <div className="h-full rounded-full bg-gradient-to-r from-brand to-teal" style={{ width: `${percent}%` }} />
            </div>
            <ul className="grid gap-2 text-sm">
              {checklist.map((item) => (
                <li key={item.label} className="flex items-center gap-2">
                  {item.done ? (
                    <CircleCheckIcon className="size-4 text-success" aria-hidden="true" />
                  ) : (
                    <CircleIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className={item.done ? "text-foreground" : "text-muted-foreground"}>{item.label}</span>
                  <span className="sr-only">{item.done ? "(done)" : "(to do)"}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href="/candidate/profile">Edit profile</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/candidate/preferences">Preferences</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </Container>
  );
}
