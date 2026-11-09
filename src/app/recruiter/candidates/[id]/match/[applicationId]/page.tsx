import { CircleCheckIcon, CircleDashedIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Container } from "@/components/layout/container";
import { loadResumeText } from "@/lib/ai/resume-source";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { fullName } from "@/lib/candidates/format";
import { getCandidateDetail } from "@/lib/candidates/queries";
import { idSchema } from "@/lib/candidates/validation";
import { compareToJob, type TermResult } from "@/lib/matching/match";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Job match evidence" };

function TermList({ title, items, emptyText }: { title: string; items: TermResult[]; emptyText: string }) {
  return (
    <section className="rounded-xl border border-border bg-background p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="mt-4 grid gap-4">
          {items.map((t) => (
            <li key={t.term} className="grid gap-1.5 text-sm">
              <p className="flex items-center gap-2 font-medium">
                {t.found ? (
                  <CircleCheckIcon className="size-4 text-success" aria-hidden="true" />
                ) : (
                  <CircleDashedIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                )}
                {t.term}
                <span className="font-normal text-muted-foreground">{t.found ? "— evidence found" : "— no evidence in the record"}</span>
              </p>
              {t.evidence.length > 0 && (
                <ul className="ml-6 grid gap-1">
                  {t.evidence.map((e, i) => (
                    <li key={i} className="text-xs">
                      <span className="text-muted-foreground">{e.source}:</span> {e.snippet}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function MatchPage({ params }: PageProps<"/recruiter/candidates/[id]/match/[applicationId]">) {
  const { id, applicationId } = await params;
  await requireRole(STAFF_ROLES, `/recruiter/candidates/${id}`);
  if (!idSchema.safeParse(id).success || !idSchema.safeParse(applicationId).success) notFound();

  const supabase = await createClient();
  const [detail, { data: app }] = await Promise.all([
    getCandidateDetail(id),
    supabase
      .from("applications")
      .select("id, jobs(id, title, required_skills, preferred_skills, companies(name))")
      .eq("id", applicationId)
      .eq("candidate_id", id)
      .maybeSingle(),
  ]);
  if (!detail || !app) notFound();
  const job = app.jobs as unknown as { id: string; title: string; required_skills: string[]; preferred_skills: string[]; companies: { name: string } | null } | null;
  if (!job) notFound();

  const resume = detail.resumes.length ? await loadResumeText(supabase, id) : null;
  const result = compareToJob({
    required: job.required_skills,
    preferred: job.preferred_skills,
    skills: detail.skills,
    certifications: detail.certifications,
    workHistory: detail.workHistory,
    headline: detail.candidate.headline,
    summary: detail.candidate.summary,
    resumeText: resume?.ok ? resume.text : null,
  });

  return (
    <Container className="grid max-w-3xl gap-6 py-10">
      <div>
        <Link href={`/recruiter/candidates/${id}`} className="text-sm text-muted-foreground hover:text-foreground">
          ← {fullName(detail.candidate)}
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Job match evidence</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {fullName(detail.candidate)} ·{" "}
          <Link href={`/recruiter/jobs/${job.id}`} className="text-brand hover:underline">
            {job.title}
          </Link>
          {job.companies?.name && ` · ${job.companies.name}`}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
        <p>
          Evidence for <strong>{result.requiredFound} of {result.required.length}</strong> required and{" "}
          <strong>{result.preferredFound} of {result.preferred.length}</strong> preferred skills.
        </p>
        <p className="mt-1 text-muted-foreground">
          This only shows where the job&apos;s skills appear in the candidate&apos;s record
          {resume?.ok ? ` and latest resume (${resume.fileName})` : resume ? ` (the resume couldn't be read: ${resume.error})` : " (no resume on file)"}. &ldquo;No
          evidence&rdquo; means it isn&apos;t written down, not that the candidate lacks it — ask them. It is not a score or a hiring decision.
        </p>
      </div>

      {result.missingRequired.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-medium">Required skills to ask about</p>
          <p className="mt-1">{result.missingRequired.join(", ")}</p>
        </div>
      )}

      <TermList title="Required skills" items={result.required} emptyText="This job has no required skills listed. Add them on the job to compare." />
      <TermList title="Preferred skills" items={result.preferred} emptyText="No preferred skills listed." />
    </Container>
  );
}
