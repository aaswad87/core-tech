import type { Metadata } from "next";
import Link from "next/link";

import { PrivacyRequestForm } from "@/components/candidate-portal/forms";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { PRIVACY_STATUS_LABELS, privacyKindLabel } from "@/lib/candidates/portal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Privacy" };

const requestDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Chicago" });

type RequestRow = {
  id: string;
  kind: string;
  status: string;
  details: string | null;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
};

export default async function CandidatePrivacyPage() {
  const user = await requireRole(["candidate"], "/candidate/privacy");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("privacy_requests")
    .select("id, kind, status, details, resolution_note, created_at, resolved_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  const requests = (data ?? []) as RequestRow[];

  return (
    <Container className="grid max-w-3xl gap-6 py-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Privacy</h1>
        <p className="mt-2 text-muted-foreground">
          Ask for a copy of your data, a correction, deletion, or for us to stop contacting you. See our{" "}
          <Link href="/privacy" className="text-brand hover:underline">
            privacy notice
          </Link>{" "}
          for how we handle your information.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Make a request</CardTitle>
          <CardDescription>An administrator reviews every request and replies to your sign-in email.</CardDescription>
        </CardHeader>
        <CardContent>
          <PrivacyRequestForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your requests</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <p role="alert" className="text-sm text-destructive">Your requests couldn&apos;t be loaded. Please refresh the page.</p>
          ) : requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">You haven&apos;t made any privacy requests.</p>
          ) : (
            <ul className="divide-y divide-border">
              {requests.map((r) => (
                <li key={r.id} className="grid gap-1 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink">{privacyKindLabel(r.kind)}</span>
                    <Badge variant={r.status === "completed" ? "secondary" : "outline"}>{PRIVACY_STATUS_LABELS[r.status] ?? r.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Sent {requestDate.format(new Date(r.created_at))}
                    {r.resolved_at && ` · closed ${requestDate.format(new Date(r.resolved_at))}`}
                  </p>
                  {r.details && <p className="whitespace-pre-line text-sm text-muted-foreground">{r.details}</p>}
                  {r.resolution_note && <p className="whitespace-pre-line text-sm">Reply: {r.resolution_note}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
