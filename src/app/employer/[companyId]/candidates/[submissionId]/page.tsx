import { DownloadIcon, StarIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CancelInterviewButton, FeedbackForm, InterviewFeedbackForm, InterviewRequestForm, SubmissionResponse } from "@/components/employer/forms";
import { hasStarted, INTERVIEW_KINDS, INTERVIEW_STATUS, labelOf } from "@/lib/interviews/validation";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { idSchema } from "@/lib/candidates/validation";
import { getSubmissionDetail } from "@/lib/employer/queries";
import {
  formatInZone,
  INTERVIEW_FORMATS,
  INTERVIEW_STATUS_LABELS,
  OPEN_SUBMISSION_STATUSES,
  SUBMISSION_STATUS_LABELS,
} from "@/lib/employer/validation";

export const metadata: Metadata = { title: "Candidate" };

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" });

export default async function EmployerSubmissionPage({ params }: PageProps<"/employer/[companyId]/candidates/[submissionId]">) {
  const { companyId, submissionId } = await params;
  if (!idSchema.safeParse(submissionId).success) notFound();
  const detail = await getSubmissionDetail(companyId, submissionId);
  if (!detail) notFound();

  const { submission: s, jobTitle, interviews, feedback, scheduled } = detail;
  const isOpen = OPEN_SUBMISSION_STATUSES.includes(s.status);
  const pendingInterview = interviews.find((i) => i.status === "requested");

  return (
    <Container className="grid max-w-4xl gap-6 py-8">
      <div>
        <Link href={`/employer/${companyId}`} className="text-sm text-muted-foreground hover:text-foreground">
          ← All candidates
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-semibold tracking-tight text-ink">{s.candidate_display_name}</h2>
          <Badge variant="outline">{SUBMISSION_STATUS_LABELS[s.status] ?? s.status}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          For {jobTitle} · submitted {dateTime.format(new Date(s.created_at))} CT
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recruiter summary</CardTitle>
          <CardDescription>Shared by CoreTech with the candidate&apos;s consent.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {s.shared_summary ? <p className="whitespace-pre-line text-sm">{s.shared_summary}</p> : <p className="text-sm text-muted-foreground">No summary was shared.</p>}
          {s.shared_resume_id && isOpen ? (
            <div>
              <Button asChild variant="outline">
                <a href={`/employer/submissions/${s.id}/resume`} rel="noreferrer">
                  <DownloadIcon aria-hidden="true" /> Download resume
                </a>
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">Downloads are logged. Please don&apos;t forward the resume outside your hiring team.</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {s.shared_resume_id ? "The resume is no longer available because this submission is closed." : "Ask your recruiter if you'd like to see a resume."}
            </p>
          )}
          {isOpen && <SubmissionResponse companyId={companyId} submissionId={s.id} status={s.status} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Interviews</CardTitle>
          <CardDescription>Propose times; CoreTech confirms with the candidate and lets you know.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {scheduled.length > 0 && (
            <ul className="grid gap-4">
              {scheduled.map((i) => (
                <li key={i.id} className="grid gap-2 rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink">
                      {labelOf(INTERVIEW_KINDS, i.kind)} · {INTERVIEW_FORMATS.find((f) => f.value === i.format)?.label}
                    </span>
                    <Badge variant={i.status === "scheduled" ? "secondary" : "outline"}>{labelOf(INTERVIEW_STATUS, i.status)}</Badge>
                  </div>
                  <p className="text-sm">
                    {formatInZone(i.starts_at, i.timezone)} · {i.duration_minutes} min
                  </p>
                  {i.status === "scheduled" && i.meeting_url && (
                    <a href={i.meeting_url} target="_blank" rel="noreferrer noopener" className="text-sm break-all text-brand hover:underline">
                      {i.meeting_url}
                    </a>
                  )}
                  {i.status === "scheduled" && i.location && <p className="text-sm">Address: {i.location}</p>}
                  {i.interviewers && <p className="text-xs text-muted-foreground">Interviewers: {i.interviewers}</p>}
                  {i.status !== "cancelled" && hasStarted(i.starts_at) && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-sm font-medium text-brand">Share feedback on this interview</summary>
                      <div className="mt-3">
                        <InterviewFeedbackForm companyId={companyId} interviewId={i.id} />
                      </div>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          {interviews.length > 0 && (
            <ul className="divide-y divide-border">
              {interviews.map((i) => (
                <li key={i.id} className="grid gap-1 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink">
                      {INTERVIEW_FORMATS.find((f) => f.value === i.format)?.label} · {i.duration_minutes} min
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant={i.status === "scheduled" ? "secondary" : "outline"}>{INTERVIEW_STATUS_LABELS[i.status] ?? i.status}</Badge>
                      {(i.status === "requested" || i.status === "scheduled") && <CancelInterviewButton companyId={companyId} requestId={i.id} />}
                    </div>
                  </div>
                  {i.status === "scheduled" && i.confirmed_time ? (
                    <p className="text-sm">Confirmed: {formatInZone(i.confirmed_time, i.timezone)}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Proposed: {i.proposed_times.map((t) => formatInZone(t, i.timezone)).join(" · ")}</p>
                  )}
                  {i.interviewers && <p className="text-xs text-muted-foreground">Interviewers: {i.interviewers}</p>}
                  {i.response_note && <p className="text-sm whitespace-pre-line">CoreTech: {i.response_note}</p>}
                </li>
              ))}
            </ul>
          )}
          {isOpen && !pendingInterview ? (
            <InterviewRequestForm companyId={companyId} submissionId={s.id} />
          ) : (
            interviews.length === 0 && <p className="text-sm text-muted-foreground">No interviews.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Feedback</CardTitle>
          <CardDescription>Visible to your team and CoreTech only.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {feedback.length > 0 && (
            <ul className="divide-y divide-border">
              {feedback.map((f) => (
                <li key={f.id} className="grid gap-1 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-ink">{f.author_name}</span>
                    {f.rating && (
                      <span className="flex items-center gap-0.5 text-amber-600" aria-label={`Rated ${f.rating} out of 5`}>
                        <StarIcon className="size-3.5 fill-current" aria-hidden="true" />
                        {f.rating}/5
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">{dateTime.format(new Date(f.created_at))} CT</span>
                  </div>
                  <p className="whitespace-pre-line text-sm">{f.body}</p>
                </li>
              ))}
            </ul>
          )}
          <FeedbackForm companyId={companyId} submissionId={s.id} />
        </CardContent>
      </Card>
    </Container>
  );
}
