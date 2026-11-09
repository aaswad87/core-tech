import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { JobMeta } from "@/components/jobs/job-meta";
import { Container } from "@/components/layout/container";
import { LeadFormSection } from "@/components/leads/lead-form-section";
import { Breadcrumbs } from "@/components/marketing/breadcrumbs";
import { GradientMesh } from "@/components/marketing/gradient-mesh";
import Link from "next/link";

import { ApplyButton } from "@/components/jobs/apply-controls";
import { getSessionUser } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env";
import { getPublishedJob } from "@/lib/jobs/public-jobs";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/jobs/[id]">): Promise<Metadata> {
  const result = await getPublishedJob((await params).id);
  if (result.status !== "ok") return { title: "Job not found", robots: { index: false } };
  const { job } = result;
  return pageMetadata({
    title: job.title,
    description: (job.public_summary ?? `${job.title} — an open role with CoreTech Recruiting.`).slice(0, 160),
    path: `/jobs/${job.id}`,
  });
}

export default async function JobDetailPage({ params }: PageProps<"/jobs/[id]">) {
  const { id } = await params;
  const result = await getPublishedJob(id);

  if (result.status === "not_found" || result.status === "unconfigured") notFound();
  if (result.status === "error") {
    // Rendered by app/jobs/[id]/error.tsx with a retry option.
    throw new Error("Job could not be loaded");
  }

  const { job } = result;
  const user = await getSessionUser();

  return (
    <>
      <section className="relative overflow-hidden bg-white">
        <GradientMesh />
        <Container className="relative py-12 sm:py-16">
          <Breadcrumbs
            items={[
              { title: "Jobs", href: "/jobs" },
              { title: job.title, href: `/jobs/${job.id}` },
            ]}
          />
          <h1 className="max-w-3xl text-3xl font-bold tracking-tight text-balance text-ink sm:text-5xl">{job.title}</h1>
          <JobMeta job={job} className="mt-4 text-muted-foreground" />
        </Container>
      </section>

      <Container className="grid gap-10 py-12 lg:grid-cols-[3fr_2fr]">
        <article>
          {job.public_summary && <p className="text-lg text-foreground">{job.public_summary}</p>}
          {job.public_description ? (
            // Plain text only — never render job content as HTML.
            <div className="mt-6 leading-relaxed whitespace-pre-line text-foreground">{job.public_description}</div>
          ) : (
            !job.public_summary && (
              <p className="text-muted-foreground">Contact a recruiter for full details about this role.</p>
            )
          )}
        </article>

        <aside aria-labelledby="interest-heading" className="h-fit rounded-xl border border-border bg-surface p-6 lg:sticky lg:top-24">
          <h2 id="interest-heading" className="text-xl font-semibold text-ink">
            Interested in this role?
          </h2>
          {user?.roles.includes("candidate") ? (
            <div className="mt-4">
              <ApplyButton jobId={job.id} />
            </div>
          ) : (
            !user &&
            isSupabaseConfigured() && (
              <p className="mt-2 text-sm">
                <Link href={`/login?next=/jobs/${job.id}`} className="font-medium text-brand hover:underline">Sign in</Link> or{" "}
                <Link href="/signup" className="font-medium text-brand hover:underline">create an account</Link> to apply.
              </p>
            )
          )}
          <p className="mt-4 mb-5 text-sm text-muted-foreground">
            Or send your details and a recruiter will contact you about this position.
          </p>
          <LeadFormSection
            type="candidate"
            sourcePath={`/jobs/${job.id}`}
            submitLabel="Send to a recruiter"
            job={{ id: job.id, title: job.title }}
          />
        </aside>
      </Container>
    </>
  );
}
