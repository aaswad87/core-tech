import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { PRIVACY_STATUS_LABELS, privacyKindLabel } from "@/lib/candidates/portal";
import { createClient } from "@/lib/supabase/server";

import { PrivacyStatusForm } from "./privacy-status-form";

export const metadata: Metadata = { title: "Privacy requests", robots: { index: false } };

const receivedDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" });

type RequestRow = {
  id: string;
  requester_email: string;
  kind: string;
  status: string;
  details: string | null;
  resolution_note: string | null;
  created_at: string;
};

export default async function AdminPrivacyPage() {
  await requireRole(["admin"], "/admin/privacy");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("privacy_requests")
    .select("id, requester_email, kind, status, details, resolution_note, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  const requests = (data ?? []) as RequestRow[];
  const pending = requests.filter((r) => r.status === "open" || r.status === "in_progress");
  const closed = requests.filter((r) => !pending.includes(r));

  return (
    <Container className="grid max-w-4xl gap-6 py-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Privacy requests</h1>
        <p className="mt-2 text-muted-foreground">
          Requests from candidates for a copy, correction or deletion of their data, or to stop contact. Reply by email, then
          record the outcome here — the requester sees the status and your reply in their portal.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">Privacy requests couldn&apos;t be loaded. Please refresh the page.</p>
      ) : (
        [
          { title: `Pending (${pending.length})`, rows: pending, empty: "No pending requests." },
          { title: `Closed (${closed.length})`, rows: closed, empty: "No closed requests yet." },
        ].map((section) => (
          <Card key={section.title}>
            <CardHeader>
              <CardTitle className="text-lg">{section.title}</CardTitle>
              {section.rows === pending && <CardDescription>Respond within the time your privacy notice promises.</CardDescription>}
            </CardHeader>
            <CardContent>
              {section.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{section.empty}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {section.rows.map((r) => (
                    <li key={r.id} className="grid gap-3 py-4 md:grid-cols-[1fr_20rem]">
                      <div className="grid gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-ink">{privacyKindLabel(r.kind)}</span>
                          <Badge variant="outline">{PRIVACY_STATUS_LABELS[r.status] ?? r.status}</Badge>
                        </div>
                        <p className="break-all text-sm">{r.requester_email}</p>
                        <p className="text-xs text-muted-foreground">Received {receivedDate.format(new Date(r.created_at))} CT</p>
                        {r.details && <p className="whitespace-pre-line text-sm text-muted-foreground">{r.details}</p>}
                      </div>
                      <PrivacyStatusForm requestId={r.id} status={r.status} note={r.resolution_note ?? ""} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </Container>
  );
}
