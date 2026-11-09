import type { Metadata } from "next";

import { JobForm } from "@/components/jobs/job-form";
import { Container } from "@/components/layout/container";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getStaffMembers } from "@/lib/candidates/queries";
import { listCompanies } from "@/lib/jobs/staff-queries";

export const metadata: Metadata = { title: "New job" };

export default async function NewJobPage() {
  await requireRole(STAFF_ROLES, "/recruiter/jobs/new");
  const [companies, staff] = await Promise.all([listCompanies(), getStaffMembers()]);
  return (
    <Container className="max-w-3xl py-10">
      <h1 className="text-3xl font-bold tracking-tight text-ink">New job</h1>
      <p className="mt-2 text-muted-foreground">Save as a draft and publish when it&apos;s ready for the public job board.</p>
      <div className="mt-8 rounded-2xl border border-border bg-background p-6 sm:p-8">
        <JobForm companies={companies} staff={staff} cancelHref="/recruiter/jobs" />
      </div>
    </Container>
  );
}
