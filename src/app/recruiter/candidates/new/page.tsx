import type { Metadata } from "next";

import { CandidateForm } from "@/components/candidates/candidate-form";
import { Container } from "@/components/layout/container";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getStaffMembers } from "@/lib/candidates/queries";

export const metadata: Metadata = { title: "Add candidate" };

export default async function NewCandidatePage() {
  await requireRole(STAFF_ROLES, "/recruiter/candidates/new");
  const staff = await getStaffMembers();

  return (
    <Container className="max-w-3xl py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Add candidate</h1>
      <p className="mt-2 text-muted-foreground">
        Add skills, certifications, work history, and resumes after saving. We&apos;ll warn you if this person may
        already be in the system.
      </p>
      <div className="mt-8 rounded-xl border border-border bg-background p-6 sm:p-8">
        <CandidateForm mode="create" staff={staff} cancelHref="/recruiter/candidates" />
      </div>
    </Container>
  );
}
