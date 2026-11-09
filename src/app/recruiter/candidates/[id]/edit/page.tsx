import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CandidateForm } from "@/components/candidates/candidate-form";
import { Container } from "@/components/layout/container";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { fullName } from "@/lib/candidates/format";
import { getStaffMembers } from "@/lib/candidates/queries";
import type { CandidateRow } from "@/lib/candidates/types";
import { idSchema } from "@/lib/candidates/validation";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Edit candidate" };

export default async function EditCandidatePage({ params }: PageProps<"/recruiter/candidates/[id]/edit">) {
  const { id } = await params;
  await requireRole(STAFF_ROLES, `/recruiter/candidates/${id}/edit`);
  if (!idSchema.safeParse(id).success) notFound();

  const supabase = await createClient();
  const [{ data }, staff] = await Promise.all([
    supabase.from("candidates").select("*").eq("id", id).maybeSingle(),
    getStaffMembers(),
  ]);
  if (!data) notFound();
  const c = data as CandidateRow;

  return (
    <Container className="max-w-3xl py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Edit {fullName(c)}</h1>
      <div className="mt-8 rounded-xl border border-border bg-background p-6 sm:p-8">
        <CandidateForm
          mode="edit"
          staff={staff}
          candidateId={c.id}
          cancelHref={`/recruiter/candidates/${c.id}`}
          initial={{
            firstName: c.first_name,
            lastName: c.last_name,
            email: c.email ?? "",
            phone: c.phone ?? "",
            location: c.location ?? "",
            headline: c.headline ?? "",
            summary: c.summary ?? "",
            source: c.source ?? "",
            ownerId: c.owner_id ?? "",
            tags: c.tags.join(", "),
          }}
        />
      </div>
    </Container>
  );
}
