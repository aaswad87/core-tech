import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CancelInterviewForm, OutcomeForm, RescheduleForm, StaffInterviewFeedbackForm } from "@/components/interviews/staff-forms";
import { FormMessage } from "@/components/forms/form-message";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { fullName } from "@/lib/candidates/format";
import { getProfileNames } from "@/lib/candidates/queries";
import { idSchema } from "@/lib/candidates/validation";
import { formatInZone, INTERVIEW_FORMATS } from "@/lib/employer/validation";
import { renderInterviewEmail } from "@/lib/interviews/email";
import { isEmailConfigured, loadInterviewEmailData } from "@/lib/interviews/notify-server";
import { getInterview } from "@/lib/interviews/staff-queries";
import { hasStarted, INTERVIEW_KINDS, INTERVIEW_OUTCOMES, INTERVIEW_STATUS, labelOf, RECOMMENDATIONS, toZonedLocalInput } from "@/lib/interviews/validation";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Interview" };

const logTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" });

const EMAIL_NOTICES: Record<string, { status: "success" | "error"; message: string }> = {
  sent: { status: "success", message: "Interview scheduled. The confirmation email was accepted by the email provider." },
  skipped: { status: "success", message: "Interview scheduled. No email was sent — see the email log below and tell the candidate yourself." },
  failed: { status: "error", message: "Interview scheduled, but the confirmation email failed. See the email log below." },
};

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

export default async function InterviewPage({ params, searchParams }: PageProps<"/recruiter/interviews/[id]">) {
  const { id } = await params;
  await requireRole(STAFF_ROLES, `/recruiter/interviews/${id}`);
  if (!idSchema.safeParse(id).success) notFound();
  const detail = await getInterview(id);
  if (!detail) notFound();

  const { interview: i, events, feedback, deliveries } = detail;
  const { notice, email } = await searchParams;
  const banner = notice === "scheduled" ? (typeof email === "string" ? EMAIL_NOTICES[email] : { status: "success" as const, message: "Interview scheduled. No email was sent." }) : null;
  const names = await getProfileNames(events.map((e) => e.actor_id));
  const emailReady = isEmailConfigured();
  const started = hasStarted(i.starts_at);
  const supabase = await createClient();
  const preview = i.status === "scheduled" ? await loadInterviewEmailData(supabase, i.id) : null;
  const previewEmail = preview ? renderInterviewEmail("scheduled", preview.data) : null;

  return (
    <Container className="grid gap-6 py-10">
      <div>
        <Link href="/recruiter/interviews" className="text-sm text-muted-foreground hover:text-foreground">
          ← All interviews
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-3 text-3xl font-semibold tracking-tight text-ink">
          {labelOf(INTERVIEW_KINDS, i.kind)}
          <Badge variant={i.status === "scheduled" ? "secondary" : "outline"}>{labelOf(INTERVIEW_STATUS, i.status)}</Badge>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {i.candidates ? (
            <Link href={`/recruiter/candidates/${i.candidate_id}`} className="text-brand hover:underline">
              {fullName(i.candidates)}
            </Link>
          ) : (
            "Candidate"
          )}
          {" · "}
          {[i.jobs?.title, i.companies?.name].filter(Boolean).join(" · ")}
          {i.submission_id && " · shared with the employer"}
        </p>
      </div>

      {banner && <FormMessage state={banner} />}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="grid content-start gap-6">
          <Panel id="details" title="Details">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[9rem_1fr]">
              <dt className="text-muted-foreground">When</dt>
              <dd>
                {formatInZone(i.starts_at, i.timezone)} · {i.duration_minutes} min
              </dd>
              <dt className="text-muted-foreground">Format</dt>
              <dd>{labelOf(INTERVIEW_FORMATS, i.format)}</dd>
              {i.meeting_url && (
                <>
                  <dt className="text-muted-foreground">Link</dt>
                  <dd className="break-all">
                    <a href={i.meeting_url} target="_blank" rel="noreferrer noopener" className="text-brand hover:underline">
                      {i.meeting_url}
                    </a>
                  </dd>
                </>
              )}
              {i.location && (
                <>
                  <dt className="text-muted-foreground">Address</dt>
                  <dd>{i.location}</dd>
                </>
              )}
              {i.interviewers && (
                <>
                  <dt className="text-muted-foreground">Interviewers</dt>
                  <dd>{i.interviewers}</dd>
                </>
              )}
              {i.instructions && (
                <>
                  <dt className="text-muted-foreground">Instructions</dt>
                  <dd className="whitespace-pre-line">{i.instructions}</dd>
                </>
              )}
              {i.cancel_reason && (
                <>
                  <dt className="text-muted-foreground">Cancelled</dt>
                  <dd>{i.cancel_reason}</dd>
                </>
              )}
              {i.outcome && (
                <>
                  <dt className="text-muted-foreground">Outcome</dt>
                  <dd>{labelOf(INTERVIEW_OUTCOMES, i.outcome)}</dd>
                </>
              )}
            </dl>
          </Panel>

          {i.status === "scheduled" && !started && (
            <Panel id="reschedule" title="Reschedule or cancel">
              <RescheduleForm
                emailReady={emailReady}
                interview={{
                  id: i.id,
                  format: i.format,
                  startsAtLocal: toZonedLocalInput(i.starts_at, i.timezone),
                  durationMinutes: i.duration_minutes,
                  timezone: i.timezone,
                  meetingUrl: i.meeting_url,
                  location: i.location,
                }}
              />
              <CancelInterviewForm interviewId={i.id} emailReady={emailReady} />
            </Panel>
          )}

          {i.status !== "cancelled" && started && (
            <Panel id="outcome" title="Outcome" description="Your record of what happened. It doesn't move the pipeline or contact anyone.">
              <OutcomeForm interviewId={i.id} status={i.status} outcome={i.outcome} summary={i.outcome_summary} />
            </Panel>
          )}

          <Panel id="feedback" title="Feedback" description={i.submission_id ? "Includes feedback from the employer's team. Never shown to the candidate." : "Internal. Never shown to the candidate."}>
            {feedback.length > 0 && (
              <ul className="divide-y divide-border">
                {feedback.map((f) => (
                  <li key={f.id} className="grid gap-1 py-3 text-sm">
                    <p>
                      <span className="font-medium text-ink">{f.author_name}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {f.author_kind === "employer" ? "Employer" : "CoreTech"}
                        {f.rating ? ` · ${f.rating}/5` : ""}
                        {f.recommendation ? ` · ${labelOf(RECOMMENDATIONS, f.recommendation)}` : ""}
                      </span>
                    </p>
                    <p className="whitespace-pre-line">{f.body}</p>
                  </li>
                ))}
              </ul>
            )}
            {i.status !== "cancelled" && <StaffInterviewFeedbackForm interviewId={i.id} />}
          </Panel>
        </div>

        <div className="grid content-start gap-6">
          <Panel id="emails" title="Email log" description="“Sent” means the email provider accepted the message, not that it reached the inbox.">
            {deliveries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No emails attempted.</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {deliveries.map((d) => (
                  <li key={d.id}>
                    <Badge variant={d.status === "sent" ? "secondary" : "outline"} className={d.status === "failed" ? "border-destructive text-destructive" : undefined}>
                      {d.status}
                    </Badge>{" "}
                    {d.subject} → <span className="break-all">{d.recipient}</span>
                    <p className="text-xs text-muted-foreground">
                      {logTime.format(new Date(d.created_at))} CT{d.error ? ` · ${d.error}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {previewEmail && (
            <Panel id="preview" title="What the candidate receives" description={preview?.optedOut ? "This candidate has turned off application emails." : undefined}>
              <pre className="max-h-80 overflow-auto rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap">{previewEmail.text}</pre>
            </Panel>
          )}

          <Panel id="history" title="History">
            <ol className="grid gap-2 text-sm">
              {events.map((e) => (
                <li key={e.id}>
                  <span className="font-medium capitalize">{e.action.replace("_", "-")}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {logTime.format(new Date(e.created_at))} CT · {e.actor_id ? (names.get(e.actor_id) ?? "Unknown") : "System"}
                  </span>
                  {e.to_starts_at && e.action === "rescheduled" && <p className="text-xs text-muted-foreground">New time: {formatInZone(e.to_starts_at, i.timezone)}</p>}
                  {e.reason && <p className="text-xs text-muted-foreground">{e.reason}</p>}
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </Container>
  );
}
