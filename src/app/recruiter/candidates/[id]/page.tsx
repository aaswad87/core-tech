import {
  FileTextIcon,
  LockIcon,
  MailIcon,
  MapPinIcon,
  PencilIcon,
  PhoneIcon,
  TriangleAlertIcon,
  UserIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AiParseButton } from "@/components/ai/forms";
import { DuplicateList } from "@/components/candidates/duplicate-list";
import {
  AddCertificationForm,
  AddNoteForm,
  AddSkillForm,
  AddWorkHistoryForm,
  RemoveButton,
  ResumeUploadForm,
} from "@/components/candidates/section-forms";
import { FormMessage } from "@/components/forms/form-message";
import { AddToJobForm } from "@/components/jobs/job-controls";
import { Container } from "@/components/layout/container";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isAdmin, STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { isAiEnabled } from "@/lib/env.server";
import {
  describeActivity,
  formatBytes,
  formatDate,
  formatDateTime,
  formatMonth,
  fullName,
} from "@/lib/candidates/format";
import { WORK_ARRANGEMENTS } from "@/lib/candidates/portal";
import { ACTIVITY_LIMIT, getCandidateDetail, getProfileNames, getCandidatePreferences } from "@/lib/candidates/queries";
import { idSchema } from "@/lib/candidates/validation";
import { listCandidateApplications, listOpenJobsForPicker } from "@/lib/jobs/staff-queries";
import { daysSince, stageLabel, stageTone } from "@/lib/pipeline/stages";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Candidate" };

// Server actions run inside this page's function. AI resume parsing waits on the provider (up to ~90 s).
export const maxDuration = 120;

const NOTICES: Record<string, string> = {
  created: "Candidate added.",
  updated: "Changes saved.",
  "ai-applied": "The selected AI suggestions were saved. Review and edit them below.",
  "ai-discarded": "AI suggestions discarded. Nothing was changed.",
};

function Panel({
  id,
  title,
  description,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className={cn("rounded-xl border border-border bg-background p-5 sm:p-6", className)}>
      <h2 id={`${id}-heading`} className="text-lg font-semibold text-ink">
        {title}
      </h2>
      {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
      <div className="mt-4 grid gap-4">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

export default async function CandidateDetailPage({ params, searchParams }: PageProps<"/recruiter/candidates/[id]">) {
  const { id } = await params;
  const user = await requireRole(STAFF_ROLES, `/recruiter/candidates/${id}`);
  if (!idSchema.safeParse(id).success) notFound();

  const detail = await getCandidateDetail(id);
  if (!detail) notFound();

  const { candidate: c, skills, certifications, workHistory, resumes, notes, activity, duplicates } = detail;
  const [applications, openJobs, preferences] = await Promise.all([
    listCandidateApplications(id),
    listOpenJobsForPicker(),
    getCandidatePreferences(id),
  ]);
  const activeJobIds = new Set(applications.filter((a) => a.status === "active" && a.jobs).map((a) => a.jobs!.id));
  const names = await getProfileNames([
    c.owner_id,
    ...notes.map((n) => n.author_id),
    ...activity.map((a) => a.actor_id),
    ...activity.flatMap((a) => [a.details?.from_owner as string, a.details?.to_owner as string]),
    ...resumes.map((r) => r.uploaded_by),
  ]);
  const { notice } = await searchParams;
  const noticeMessage = typeof notice === "string" ? NOTICES[notice] : undefined;
  const canDeleteAnyNote = isAdmin(user.roles);
  const aiEnabled = isAiEnabled();

  return (
    <Container className="py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/recruiter/candidates" className="text-sm text-muted-foreground hover:text-foreground">
            ← All candidates
          </Link>
          <h1 className="mt-2 flex flex-wrap items-center gap-3 text-3xl font-semibold tracking-tight text-ink">
            {fullName(c)}
            {c.is_demo && <Badge variant="outline">Demo data</Badge>}
          </h1>
          {c.headline && <p className="mt-1 text-lg text-foreground">{c.headline}</p>}
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <UserIcon className="size-4" aria-hidden="true" />
            Owner: {c.owner_id ? (names.get(c.owner_id) ?? "Unknown") : "Unassigned"}
          </p>
        </div>
        <Button asChild variant="outline" size="lg" className="h-10">
          <Link href={`/recruiter/candidates/${c.id}/edit`}>
            <PencilIcon aria-hidden="true" /> Edit
          </Link>
        </Button>
      </div>

      <div className="mt-6 grid gap-4">
        {noticeMessage && <FormMessage state={{ status: "success", message: noticeMessage }} />}
        {duplicates.length > 0 && (
          <Alert className="border-amber-300 bg-amber-50 text-amber-950">
            <TriangleAlertIcon />
            <AlertTitle>Possible duplicate records</AlertTitle>
            <AlertDescription className="grid gap-2 text-amber-950">
              <p>These candidates share an email, phone number, or name with this record.</p>
              <DuplicateList matches={duplicates} />
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="grid content-start gap-6">
          <Panel id="overview" title="Overview">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {[
                { icon: MailIcon, label: "Email", value: c.email && <a href={`mailto:${c.email}`} className="text-brand hover:underline">{c.email}</a> },
                { icon: PhoneIcon, label: "Phone", value: c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="text-brand hover:underline">{c.phone}</a> },
                { icon: MapPinIcon, label: "Location", value: c.location },
                { icon: FileTextIcon, label: "Source", value: c.source },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-start gap-2">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <Icon className="size-4" aria-hidden="true" />
                    <span className="sr-only">{label}</span>
                  </dt>
                  <dd className="break-all">{value || <span className="text-muted-foreground">No {label.toLowerCase()}</span>}</dd>
                </div>
              ))}
            </dl>
            {c.summary && <p className="text-sm whitespace-pre-line">{c.summary}</p>}
            {c.tags.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
                {c.tags.map((t) => (
                  <li key={t}>
                    <Link href={`/recruiter/candidates?tag=${encodeURIComponent(t)}`} className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted">
                      #{t}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {preferences && (
            <Panel id="preferences" title="Candidate preferences" description="Set by the candidate in their portal.">
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
                <dt className="text-muted-foreground">Looking</dt>
                <dd>{preferences.open_to_opportunities ? "Open to new opportunities" : "Not looking right now"}</dd>
                <dt className="text-muted-foreground">Roles</dt>
                <dd>{preferences.desired_titles || <span className="text-muted-foreground">Not given</span>}</dd>
                <dt className="text-muted-foreground">Locations</dt>
                <dd>
                  {preferences.preferred_locations || <span className="text-muted-foreground">Not given</span>}
                  {preferences.willing_to_relocate && " · willing to relocate"}
                </dd>
                <dt className="text-muted-foreground">Arrangement</dt>
                <dd>{WORK_ARRANGEMENTS.find((w) => w.value === preferences.work_arrangement)?.label ?? "No preference"}</dd>
                <dt className="text-muted-foreground">Contact</dt>
                <dd>
                  {[
                    preferences.email_application_updates && "Application emails",
                    preferences.email_job_alerts && "Job alert emails",
                    preferences.phone_contact_ok && "Calls/texts OK",
                  ]
                    .filter(Boolean)
                    .join(" · ") || "No email or phone contact"}
                </dd>
              </dl>
            </Panel>
          )}

          <Panel id="work" title="Work history">
            {workHistory.length === 0 ? (
              <Empty>No work history yet.</Empty>
            ) : (
              <ol className="grid gap-4">
                {workHistory.map((w) => (
                  <li key={w.id} className="flex items-start justify-between gap-3 border-l-2 border-brand/40 pl-4">
                    <div>
                      <p className="font-medium text-ink">{w.title}</p>
                      <p className="text-sm">{[w.company_name, w.location].filter(Boolean).join(" · ")}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatMonth(w.start_date) ?? "Start unknown"} – {w.is_current ? "Present" : (formatMonth(w.end_date) ?? "End unknown")}
                      </p>
                      {w.description && <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">{w.description}</p>}
                    </div>
                    <RemoveButton kind="workHistory" candidateId={c.id} rowId={w.id} label={`${w.title} at ${w.company_name}`} confirm />
                  </li>
                ))}
              </ol>
            )}
            <AddWorkHistoryForm candidateId={c.id} />
          </Panel>

          <div className="grid gap-6 md:grid-cols-2">
            <Panel id="skills" title="Skills">
              {skills.length === 0 ? (
                <Empty>No skills yet.</Empty>
              ) : (
                <ul className="grid gap-1">
                  {skills.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                      <span>
                        <Link href={`/recruiter/candidates?skill=${encodeURIComponent(s.name)}`} className="font-medium hover:underline">{s.name}</Link>
                        {s.years_experience !== null && <span className="text-muted-foreground"> · {Number(s.years_experience)} yrs</span>}
                      </span>
                      <RemoveButton kind="skill" candidateId={c.id} rowId={s.id} label={s.name} />
                    </li>
                  ))}
                </ul>
              )}
              <AddSkillForm candidateId={c.id} />
            </Panel>

            <Panel id="certifications" title="Certifications">
              {certifications.length === 0 ? (
                <Empty>No certifications yet.</Empty>
              ) : (
                <ul className="grid gap-2">
                  {certifications.map((cert) => {
                    const expired = cert.expires_on !== null && cert.expires_on < new Date().toISOString().slice(0, 10);
                    return (
                      <li key={cert.id} className="flex items-start justify-between gap-2 text-sm">
                        <div>
                          <p className="font-medium">
                            {cert.name} {expired && <Badge variant="destructive" className="ml-1">Expired</Badge>}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {[cert.issuer, cert.credential_id && `ID ${cert.credential_id}`, cert.issued_on && `Issued ${formatDate(cert.issued_on)}`, cert.expires_on && `Expires ${formatDate(cert.expires_on)}`]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <RemoveButton kind="certification" candidateId={c.id} rowId={cert.id} label={cert.name} />
                      </li>
                    );
                  })}
                </ul>
              )}
              <AddCertificationForm candidateId={c.id} />
            </Panel>
          </div>
        </div>

        <div className="grid content-start gap-6">
          <Panel id="applications" title="Applications" description="Where this candidate is in each job's pipeline.">
            {applications.length === 0 ? (
              <Empty>Not in any job pipeline yet.</Empty>
            ) : (
              <ul className="grid gap-3">
                {applications.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      {a.jobs ? (
                        <Link href={`/recruiter/jobs/${a.jobs.id}`} className="font-medium text-brand hover:underline">
                          {a.jobs.title}
                        </Link>
                      ) : (
                        <span className="font-medium">Job removed</span>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {[a.jobs?.companies?.name, `${daysSince(a.stage_changed_at)} days in stage`].filter(Boolean).join(" · ")}
                      </p>
                      <div className="flex flex-wrap gap-3">
                        {a.status === "active" && (
                          <Link href={`/recruiter/interviews/new?application=${a.id}`} className="text-xs text-brand hover:underline">
                            Schedule interview
                          </Link>
                        )}
                        {a.jobs && (
                          <Link href={`/recruiter/candidates/${c.id}/match/${a.id}`} className="text-xs text-brand hover:underline">
                            Compare to job
                          </Link>
                        )}
                        {isAdmin(user.roles) && (a.stage === "offer" || a.stage === "placed") && (
                          <Link href={`/recruiter/finance/placements/new?application=${a.id}`} className="text-xs text-brand hover:underline">
                            Record placement
                          </Link>
                        )}
                      </div>
                    </div>
                    <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium", stageTone(a.stage))}>{stageLabel(a.stage)}</span>
                  </li>
                ))}
              </ul>
            )}
            <AddToJobForm candidateId={c.id} jobs={openJobs.filter((j) => !activeJobIds.has(j.id))} />
          </Panel>

          <Panel
            id="resumes"
            title="Resumes"
            description={
              <span className="flex items-center gap-1.5">
                <LockIcon className="size-3.5" aria-hidden="true" /> Private storage. Downloads use links that expire after 60 seconds.
              </span>
            }
          >
            {resumes.length === 0 ? (
              <Empty>No resumes uploaded.</Empty>
            ) : (
              <ul className="grid gap-3">
                {resumes.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <a
                        href={`/recruiter/candidates/${c.id}/resumes/${r.id}`}
                        className="font-medium break-all text-brand hover:underline"
                        rel="noreferrer"
                      >
                        {r.file_name}
                      </a>
                      <p className="text-xs text-muted-foreground">
                        {r.mime_type === "application/pdf" ? "PDF" : "Word"} · {formatBytes(r.size_bytes)} · {formatDateTime(r.created_at)}
                        {r.uploaded_by && ` · ${names.get(r.uploaded_by) ?? "Unknown"}`}
                      </p>
                      {aiEnabled && <AiParseButton candidateId={c.id} resumeId={r.id} fileName={r.file_name} />}
                    </div>
                    <RemoveButton kind="resume" candidateId={c.id} rowId={r.id} label={r.file_name} confirm />
                  </li>
                ))}
              </ul>
            )}
            <ResumeUploadForm candidateId={c.id} />
          </Panel>

          <Panel id="notes" title="Internal notes" description="Staff only. Never shown to candidates or employers.">
            <AddNoteForm candidateId={c.id} />
            {notes.length === 0 ? (
              <Empty>No notes yet.</Empty>
            ) : (
              <ul className="grid gap-3">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-lg bg-muted p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        {n.author_id ? (names.get(n.author_id) ?? "Unknown") : "Former user"} · {formatDateTime(n.created_at)}
                      </p>
                      {(n.author_id === user.id || canDeleteAnyNote) && (
                        <RemoveButton kind="note" candidateId={c.id} rowId={n.id} label="note" confirm />
                      )}
                    </div>
                    <p className="mt-1 text-sm whitespace-pre-line">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel id="activity" title="Activity" description={activity.length === ACTIVITY_LIMIT ? `Latest ${ACTIVITY_LIMIT} entries.` : undefined}>
            {activity.length === 0 ? (
              <Empty>No activity yet.</Empty>
            ) : (
              <ol className="grid gap-3">
                {activity.map((a) => (
                  <li key={a.id} className="text-sm">
                    <p>{describeActivity(a, names)}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.actor_id ? (names.get(a.actor_id) ?? "Unknown") : "System"} · {formatDateTime(a.created_at)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </Container>
  );
}
