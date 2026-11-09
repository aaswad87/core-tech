import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { JobForm } from "@/components/jobs/job-form";
import { Container } from "@/components/layout/container";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getStaffMembers } from "@/lib/candidates/queries";
import { idSchema } from "@/lib/candidates/validation";
import { getStaffJob, listCompanies } from "@/lib/jobs/staff-queries";

export const metadata: Metadata = { title: "Edit job" };

export default async function EditJobPage({ params }: PageProps<"/recruiter/jobs/[id]/edit">) {
  const { id } = await params;
  await requireRole(STAFF_ROLES, `/recruiter/jobs/${id}/edit`);
  if (!idSchema.safeParse(id).success) notFound();
  const [job, companies, staff] = await Promise.all([getStaffJob(id), listCompanies(), getStaffMembers()]);
  if (!job) notFound();

  const str = (v: number | string | null) => (v === null || v === undefined ? "" : String(v));
  return (
    <Container className="max-w-3xl py-10">
      <h1 className="text-3xl font-bold tracking-tight text-ink">Edit job</h1>
      <div className="mt-8 rounded-2xl border border-border bg-background p-6 sm:p-8">
        <JobForm
          jobId={job.id}
          companies={companies}
          staff={staff}
          cancelHref={`/recruiter/jobs/${job.id}`}
          initial={{
            title: job.title,
            companyId: job.company_id,
            status: job.status,
            ownerId: str(job.owner_id),
            location: str(job.location),
            workArrangement: str(job.work_arrangement),
            employmentType: job.employment_type,
            salaryMin: str(job.salary_min),
            salaryMax: str(job.salary_max),
            requiredSkills: job.required_skills.join(", "),
            preferredSkills: job.preferred_skills.join(", "),
            publicSummary: str(job.public_summary),
            publicDescription: str(job.public_description),
            description: str(job.description),
          }}
        />
      </div>
    </Container>
  );
}
