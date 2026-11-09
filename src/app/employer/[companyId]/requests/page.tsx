import type { Metadata } from "next";

import { CancelJobRequestButton, JobRequestForm } from "@/components/employer/forms";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listJobRequests } from "@/lib/employer/queries";
import { JOB_REQUEST_STATUS_LABELS } from "@/lib/employer/validation";
import { EMPLOYMENT_TYPES } from "@/lib/jobs/validation";

export const metadata: Metadata = { title: "Job requests" };

const sentDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Chicago" });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function salary(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `${usd.format(min)}–${usd.format(max)}`;
  return min != null ? `From ${usd.format(min)}` : `Up to ${usd.format(max!)}`;
}

export default async function EmployerRequestsPage({ params }: PageProps<"/employer/[companyId]/requests">) {
  const { companyId } = await params;
  const requests = await listJobRequests(companyId);

  return (
    <Container className="grid max-w-4xl gap-6 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Request a new job</CardTitle>
          <CardDescription>Tell us about the role. A recruiter reviews it, confirms the details with you and opens the search.</CardDescription>
        </CardHeader>
        <CardContent>
          <JobRequestForm companyId={companyId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your requests</CardTitle>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No job requests yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {requests.map((r) => (
                <li key={r.id} className="grid gap-1 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink">{r.title}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={r.status === "converted" ? "secondary" : "outline"}>{JOB_REQUEST_STATUS_LABELS[r.status] ?? r.status}</Badge>
                      {(r.status === "submitted" || r.status === "in_review") && <CancelJobRequestButton companyId={companyId} requestId={r.id} />}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[
                      `Sent ${sentDate.format(new Date(r.created_at))}`,
                      EMPLOYMENT_TYPES.find((t) => t.value === r.employment_type)?.label,
                      `${r.openings} opening${r.openings === 1 ? "" : "s"}`,
                      r.location,
                      salary(r.salary_min, r.salary_max),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {r.response_note && <p className="text-sm whitespace-pre-line">CoreTech: {r.response_note}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
