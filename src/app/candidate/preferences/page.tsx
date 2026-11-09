import type { Metadata } from "next";

import { PreferencesForm } from "@/components/candidate-portal/forms";
import { Container } from "@/components/layout/container";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { loadMyPortal } from "@/lib/candidates/portal-queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Preferences" };

export default async function CandidatePreferencesPage() {
  const user = await requireRole(["candidate"], "/candidate/preferences");
  const supabase = await createClient();
  const portal = await loadMyPortal(supabase, user.id);

  return (
    <Container className="grid max-w-3xl gap-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Preferences</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Job interests and contact choices</CardTitle>
          <CardDescription>Recruiters see these when looking for candidates. You can change them at any time.</CardDescription>
        </CardHeader>
        <CardContent>
          <PreferencesForm preferences={portal.preferences} />
        </CardContent>
      </Card>
    </Container>
  );
}
