import { ExternalLinkIcon, KanbanSquareIcon, MapPinIcon, PencilIcon, SearchIcon, TableIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FormMessage } from "@/components/forms/form-message";
import { AddCandidateButton, JobStatusButtons } from "@/components/jobs/job-controls";
import { Container } from "@/components/layout/container";
import { PipelineView } from "@/components/pipeline/pipeline-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getProfileNames } from "@/lib/candidates/queries";
import type { CandidateListRow } from "@/lib/candidates/types";
import { idSchema } from "@/lib/candidates/validation";
import { getStaffJob, listPipeline } from "@/lib/jobs/staff-queries";
import { EMPLOYMENT_TYPES, JOB_STATUS_TONES, jobStatusLabel, WORK_ARRANGEMENT_OPTIONS } from "@/lib/jobs/validation";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Job" };

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const NOTICES: Record<string, string> = { created: "Job created.", saved: "Job saved." };

/** The status buttons offered depend on where the job is now. */
function statusActions(status: string) {
  switch (status) {
    case "draft":
    case "pending":
      return [{ status: "published", label: "Publish", primary: true }, ...(status === "draft" ? [{ status: "pending", label: "Mark pending approval" }] : [])];
    case "published":
      return [{ status: "paused", label: "Pause" }, { status: "closed", label: "Close" }];
    case "paused":
      return [{ status: "published", label: "Republish", primary: true }, { status: "closed", label: "Close" }];
    case "closed":
      return [{ status: "published", label: "Reopen" }, { status: "archived", label: "Archive" }];
    default:
      return [{ status: "draft", label: "Restore as draft" }];
  }
}

export default async function StaffJobPage({ params, searchParams }: PageProps<"/recruiter/jobs/[id]">) {
  const { id } = await params;
  await requireRole(STAFF_ROLES, `/recruiter/jobs/${id}`);
  if (!idSchema.safeParse(id).success) notFound();

  const sp = await searchParams;
  const view = sp.view === "table" ? "table" : "board";
  const findQuery = (typeof sp.find === "string" ? sp.find : "").trim().slice(0, 100);

  const job = await getStaffJob(id);
  if (!job) notFound();

  const supabase = await createClient();
  const [cards, found] = await Promise.all([
    listPipeline({ jobId: id, includeClosed: true }),
    findQuery
      ? supabase.rpc("search_candidates", { p_query: findQuery, p_limit: 10, p_offset: 0 }).then((r) => (r.data ?? []) as CandidateListRow[])
      : Promise.resolve([] as CandidateListRow[]),
  ]);
  const names = await getProfileNames([job.owner_id, ...cards.flatMap((c) => c.history.map((h) => h.actorId))]);
  const inPipeline = new Set(cards.filter((c) => c.status === "active").map((c) => c.candidate.id));
  const notice = typeof sp.notice === "string" ? NOTICES[sp.notice] : undefined;
  const salary = job.salary_min || job.salary_max ? [job.salary_min, job.salary_max].filter((v) => v !== null).map((v) => money.format(Number(v))).join(" – ") : null;

  return (
    <Container className="py-10">
      <Link href="/recruiter/jobs" className="text-sm text-muted-foreground hover:text-foreground">
        ← All jobs
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", JOB_STATUS_TONES[job.status])}>{jobStatusLabel(job.status)}</span>
            {job.is_demo && <Badge variant="outline">Demo data</Badge>}
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">{job.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
            <span className="font-medium text-ink">{job.companies?.name}</span>
            {job.location && (
              <span className="flex items-center gap-1">
                <MapPinIcon className="size-4" aria-hidden="true" /> {job.location}
              </span>
            )}
            {job.work_arrangement && <span>{WORK_ARRANGEMENT_OPTIONS.find((w) => w.value === job.work_arrangement)?.label}</span>}
            <span>{EMPLOYMENT_TYPES.find((t) => t.value === job.employment_type)?.label}</span>
            {salary && <span>{salary}</span>}
            <span>Owner: {job.owner_id ? (names.get(job.owner_id) ?? "Unknown") : "Unassigned"}</span>
          </p>
        </div>
        <div className="grid justify-items-end gap-2">
          <div className="flex flex-wrap gap-2">
            {job.status === "published" && (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/jobs/${job.id}`} target="_blank">
                  Public page <ExternalLinkIcon aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </Link>
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href={`/recruiter/jobs/${job.id}/edit`}>
                <PencilIcon aria-hidden="true" /> Edit
              </Link>
            </Button>
          </div>
          <JobStatusButtons jobId={job.id} actions={statusActions(job.status)} />
        </div>
      </div>

      {notice && (
        <div className="mt-4">
          <FormMessage state={{ status: "success", message: notice }} />
        </div>
      )}

      {(job.required_skills.length > 0 || job.preferred_skills.length > 0) && (
        <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-sm">
          {job.required_skills.length > 0 && (
            <div>
              <dt className="mb-1 text-muted-foreground">Required</dt>
              <dd className="flex flex-wrap gap-1.5">
                {job.required_skills.map((s) => (
                  <span key={s} className="rounded-full bg-brand-50 px-2.5 py-0.5 font-medium text-brand-700">{s}</span>
                ))}
              </dd>
            </div>
          )}
          {job.preferred_skills.length > 0 && (
            <div>
              <dt className="mb-1 text-muted-foreground">Preferred</dt>
              <dd className="flex flex-wrap gap-1.5">
                {job.preferred_skills.map((s) => (
                  <span key={s} className="rounded-full border border-border px-2.5 py-0.5">{s}</span>
                ))}
              </dd>
            </div>
          )}
        </dl>
      )}

      <section aria-labelledby="pipeline-heading" className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="pipeline-heading" className="text-xl font-semibold text-ink">
            Pipeline <span className="text-base font-normal text-muted-foreground">({cards.filter((c) => c.status === "active").length} active)</span>
          </h2>
          <div className="flex gap-1 rounded-full border border-border bg-background p-1" role="group" aria-label="Pipeline view">
            <Button asChild size="sm" variant={view === "board" ? "default" : "ghost"} className="rounded-full">
              <Link href={`/recruiter/jobs/${job.id}`} aria-current={view === "board" ? "page" : undefined}>
                <KanbanSquareIcon aria-hidden="true" /> Board
              </Link>
            </Button>
            <Button asChild size="sm" variant={view === "table" ? "default" : "ghost"} className="rounded-full">
              <Link href={`/recruiter/jobs/${job.id}?view=table`} aria-current={view === "table" ? "page" : undefined}>
                <TableIcon aria-hidden="true" /> Table
              </Link>
            </Button>
          </div>
        </div>
        <div className="mt-4">
          <PipelineView cards={cards} view={view} showJob={false} actorNames={Object.fromEntries(names)} />
        </div>
      </section>

      <section aria-labelledby="add-heading" className="mt-10 rounded-2xl border border-border bg-background p-5">
        <h2 id="add-heading" className="text-lg font-semibold text-ink">
          Add a candidate
        </h2>
        <form role="search" action={`/recruiter/jobs/${job.id}`} className="mt-3 flex max-w-xl gap-2">
          {view === "table" && <input type="hidden" name="view" value="table" />}
          <label htmlFor="find-candidate" className="sr-only">
            Search candidates
          </label>
          <input
            id="find-candidate"
            name="find"
            type="search"
            defaultValue={findQuery || job.required_skills[0] || ""}
            placeholder="Name, skill, location…"
            className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
          />
          <Button type="submit" variant="outline" className="h-9">
            <SearchIcon aria-hidden="true" /> Search
          </Button>
        </form>
        {findQuery && (
          <ul className="mt-4 divide-y divide-border">
            {found.length === 0 && <li className="py-3 text-sm text-muted-foreground">No candidates match “{findQuery}”.</li>}
            {found.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <Link href={`/recruiter/candidates/${c.id}`} className="font-medium text-ink hover:text-brand hover:underline">
                    {c.first_name} {c.last_name}
                  </Link>
                  <p className="text-xs text-muted-foreground">{[c.headline, c.location, c.skills.slice(0, 4).join(", ")].filter(Boolean).join(" · ")}</p>
                </div>
                {inPipeline.has(c.id) ? (
                  <span className="text-sm text-muted-foreground">In pipeline</span>
                ) : (
                  <AddCandidateButton jobId={job.id} candidateId={c.id} label={`${c.first_name} ${c.last_name}`} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {(job.public_summary || job.description) && (
        <section aria-labelledby="desc-heading" className="mt-10 grid gap-6 md:grid-cols-2">
          <h2 id="desc-heading" className="sr-only">
            Descriptions
          </h2>
          {job.public_summary && (
            <div className="rounded-2xl border border-border bg-background p-5">
              <h3 className="text-sm font-semibold text-ink">Public summary</h3>
              <p className="mt-2 text-sm whitespace-pre-line">{job.public_summary}</p>
            </div>
          )}
          {job.description && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
              <h3 className="text-sm font-semibold text-ink">Internal notes (staff only)</h3>
              <p className="mt-2 text-sm whitespace-pre-line">{job.description}</p>
            </div>
          )}
        </section>
      )}
    </Container>
  );
}
