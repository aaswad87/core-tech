import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Container } from "@/components/layout/container";
import { HuntForm } from "@/components/market/radar-forms";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { idSchema } from "@/lib/candidates/validation";
import { listHunts } from "@/lib/market/queries";

export const metadata: Metadata = { title: "Edit hunt" };

export default async function EditHuntPage({ params }: PageProps<"/recruiter/market/hunts/[id]/edit">) {
  const { id } = await params;
  await requireRole(STAFF_ROLES, `/recruiter/market/hunts/${id}/edit`);
  if (!idSchema.safeParse(id).success) notFound();
  const hunt = (await listHunts()).find((h) => h.id === id);
  if (!hunt) notFound();

  return (
    <Container className="max-w-3xl py-10">
      <h1 className="text-3xl font-bold tracking-tight text-ink">Edit hunt</h1>
      <div className="mt-8 rounded-2xl border border-border bg-background p-6 sm:p-8">
        <HuntForm
          huntId={hunt.id}
          defaults={{
            name: hunt.name,
            keywords: hunt.keywords.join(", "),
            excludeKeywords: hunt.exclude_keywords.join(", "),
            locations: hunt.locations.join(", "),
            includeRemote: hunt.include_remote,
            sources: hunt.sources,
            minScore: hunt.min_score,
          }}
        />
      </div>
    </Container>
  );
}
