import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { HuntForm } from "@/components/market/radar-forms";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "New hunt" };

export default async function NewHuntPage() {
  await requireRole(STAFF_ROLES, "/recruiter/market/hunts/new");
  return (
    <Container className="max-w-3xl py-10">
      <h1 className="text-3xl font-bold tracking-tight text-ink">New hunt</h1>
      <p className="mt-2 text-muted-foreground">
        Describe the jobs you want to hear about. You&apos;ll be subscribed to email alerts automatically.
      </p>
      <div className="mt-8 rounded-2xl border border-border bg-background p-6 sm:p-8">
        <HuntForm defaults={{ keywords: "network engineer, BGP, SD-WAN", locations: "Texas", includeRemote: true, minScore: 3 }} />
      </div>
    </Container>
  );
}
