import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AddMemberForm,
  DeclineInterviewRequestForm,
  JobRequestReview,
  MemberRequestButtons,
  RemoveMemberButton,
  ShareResumeForm,
} from "@/components/companies/staff-forms";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { idSchema } from "@/lib/candidates/validation";
import { getCompanyForStaff } from "@/lib/employer/staff-queries";
import {
  formatInZone,
  INTERVIEW_FORMATS,
  INTERVIEW_STATUS_LABELS,
  JOB_REQUEST_STATUS_LABELS,
  OPEN_SUBMISSION_STATUSES,
  SUBMISSION_STATUS_LABELS,
} from "@/lib/employer/validation";
import { EMPLOYMENT_TYPES } from "@/lib/jobs/validation";

export const metadata: Metadata = { title: "Company" };

const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Chicago" });

function Panel({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="rounded-xl border border-border bg-background p-5 sm:p-6">
      <h2 id={`${id}-heading`} className="text-lg font-semibold text-ink">
        {title}
      </h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-4 grid gap-4">{children}</div>
    </section>
  );
}

export default async function StaffCompanyPage({ params }: PageProps<"/recruiter/companies/[id]">) {
  const { id } = await params;
  await requireRole(STAFF_ROLES, `/recruiter/companies/${id}`);
  if (!idSchema.safeParse(id).success) notFound();
  const data = await getCompanyForStaff(id);
  if (!data) notFound();

  const { company, team, memberRequests, jobRequests, submissions, interviews, feedback, resumes } = data;
  const openJobRequests = jobRequests.filter((r) => r.status === "submitted" || r.status === "in_review");
  const closedJobRequests = jobRequests.filter((r) => !openJobRequests.includes(r));
  const pendingInterviews = interviews.filter((i) => i.status === "requested");
  const submissionName = new Map(submissions.map((s) => [s.id, s.candidate_display_name]));

  return (
    <Container className="grid gap-6 py-10">
      <div>
        <Link href="/recruiter/companies" className="text-sm text-muted-foreground hover:text-foreground">
          ← All companies
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-3 text-3xl font-semibold tracking-tight text-ink">
          {company.name}
          {company.is_demo && <Badge variant="outline">Demo data</Badge>}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {[company.industry, company.headquarters, company.website].filter(Boolean).join(" · ") || "No profile details yet."}
        </p>
        {company.about && <p className="mt-2 max-w-3xl text-sm whitespace-pre-line">{company.about}</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="grid content-start gap-6">
          <Panel id="interviews" title={`Interview requests (${pendingInterviews.length} waiting)`} description="Confirm a time with the candidate, then schedule it — or decline with a reason.">
            {interviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">No interview requests.</p>
            ) : (
              <ul className="divide-y divide-border">
                {interviews.map((i) => (
                  <li key={i.id} className="grid gap-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-ink">
                        {submissionName.get(i.submission_id) ?? "Candidate"} · {INTERVIEW_FORMATS.find((f) => f.value === i.format)?.label}, {i.duration_minutes} min
                      </span>
                      <Badge variant="outline">{INTERVIEW_STATUS_LABELS[i.status] ?? i.status}</Badge>
                    </div>
                    {i.status === "scheduled" && i.confirmed_time ? (
                      <p className="text-sm">Confirmed: {formatInZone(i.confirmed_time, i.timezone)}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">Proposed: {i.proposed_times.map((t) => formatInZone(t, i.timezone)).join(" · ")}</p>
                    )}
                    {i.interviewers && <p className="text-xs text-muted-foreground">Interviewers: {i.interviewers}</p>}
                    {i.notes && <p className="text-sm whitespace-pre-line text-muted-foreground">{i.notes}</p>}
                    {i.status === "requested" && (
                      <div className="grid gap-2">
                        <div>
                          <Link href={`/recruiter/interviews/new?request=${i.id}`} className="inline-flex h-8 items-center rounded-full bg-brand px-3 text-sm font-medium text-white hover:bg-brand-700">
                            Schedule interview
                          </Link>
                        </div>
                        <DeclineInterviewRequestForm companyId={company.id} requestId={i.id} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel id="submissions" title="Submitted candidates" description="Choose which resume (if any) the employer may open. Access ends when the submission closes.">
            {submissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No candidates submitted yet. Submit from the pipeline.</p>
            ) : (
              <ul className="divide-y divide-border">
                {submissions.map((s) => {
                  const notes = feedback.filter((f) => f.submission_id === s.id);
                  return (
                    <li key={s.id} className="grid gap-2 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <Link href={`/recruiter/candidates/${s.candidate_id}`} className="font-medium text-ink hover:text-brand hover:underline">
                            {s.candidate_display_name}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {s.jobs?.title ?? "Job"} · submitted {date.format(new Date(s.created_at))}
                          </p>
                        </div>
                        <Badge variant="outline">Employer: {SUBMISSION_STATUS_LABELS[s.status] ?? s.status}</Badge>
                      </div>
                      {OPEN_SUBMISSION_STATUSES.includes(s.status) && (
                        <ShareResumeForm
                          companyId={company.id}
                          submissionId={s.id}
                          sharedResumeId={s.shared_resume_id}
                          resumes={resumes.filter((r) => r.candidate_id === s.candidate_id)}
                        />
                      )}
                      {notes.length > 0 && (
                        <ul className="grid gap-1 rounded-lg bg-muted/50 p-3 text-sm">
                          {notes.map((f) => (
                            <li key={f.id}>
                              <span className="font-medium">Employer feedback{f.rating ? ` (${f.rating}/5)` : ""}:</span> {f.body}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel id="job-requests" title={`Job requests (${openJobRequests.length} open)`}>
            {jobRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No job requests from this company.</p>
            ) : (
              <ul className="divide-y divide-border">
                {[...openJobRequests, ...closedJobRequests].map((r) => (
                  <li key={r.id} className="grid gap-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-ink">{r.title}</span>
                      <Badge variant="outline">{JOB_REQUEST_STATUS_LABELS[r.status] ?? r.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {[
                        date.format(new Date(r.created_at)),
                        EMPLOYMENT_TYPES.find((t) => t.value === r.employment_type)?.label,
                        `${r.openings} opening${r.openings === 1 ? "" : "s"}`,
                        r.location,
                        r.target_start && `start ${r.target_start}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="text-sm whitespace-pre-line">{r.description}</p>
                    {r.must_have_skills && <p className="text-sm text-muted-foreground">Must have: {r.must_have_skills}</p>}
                    {r.response_note && <p className="text-sm">Reply: {r.response_note}</p>}
                    {r.job_id && (
                      <Link href={`/recruiter/jobs/${r.job_id}`} className="text-sm text-brand hover:underline">
                        Open the job
                      </Link>
                    )}
                    {openJobRequests.includes(r) && <JobRequestReview companyId={company.id} requestId={r.id} status={r.status} />}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="grid content-start gap-6">
          <Panel id="team" title="Employer portal access" description="People here can see this company's jobs and submitted candidates.">
            {team.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody has access yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {team.map((m) => (
                  <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{m.full_name ?? m.email}</p>
                      <p className="text-xs break-all text-muted-foreground">
                        {m.email} · {m.member_role === "owner" ? "Owner" : "Member"}
                      </p>
                    </div>
                    <RemoveMemberButton companyId={company.id} userId={m.user_id} name={m.full_name ?? m.email} />
                  </li>
                ))}
              </ul>
            )}
            <AddMemberForm companyId={company.id} />
          </Panel>

          {memberRequests.length > 0 && (
            <Panel id="member-requests" title="Teammate requests" description="Make sure they have an account with the Employer role, give access above, then mark done.">
              <ul className="divide-y divide-border">
                {memberRequests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0 text-sm">
                      <p className="font-medium text-ink">{r.full_name}</p>
                      <p className="text-xs break-all text-muted-foreground">
                        {r.email} · {r.member_role === "owner" ? "Owner" : "Member"}
                      </p>
                    </div>
                    <MemberRequestButtons companyId={company.id} requestId={r.id} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </Container>
  );
}
