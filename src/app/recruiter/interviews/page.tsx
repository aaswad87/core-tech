import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { fullName } from "@/lib/candidates/format";
import { formatInZone } from "@/lib/employer/validation";
import { isEmailConfigured } from "@/lib/interviews/notify-server";
import { listInterviews } from "@/lib/interviews/staff-queries";
import { INTERVIEW_KINDS, INTERVIEW_STATUS, labelOf } from "@/lib/interviews/validation";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Interviews" };

export default async function InterviewsPage({ searchParams }: PageProps<"/recruiter/interviews">) {
  await requireRole(STAFF_ROLES, "/recruiter/interviews");
  const { view: rawView } = await searchParams;
  const view = rawView === "past" ? "past" : "upcoming";
  const { interviews, needsOutcome, pendingRequests } = await listInterviews(view);
  const emailReady = isEmailConfigured();

  return (
    <Container className="grid gap-6 py-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Interviews</h1>
        <p className="mt-2 text-muted-foreground">
          Schedule from a candidate&apos;s Applications list or from an employer&apos;s interview request.
          {!emailReady && " Email isn't set up yet, so candidates won't get automatic emails."}
        </p>
      </div>

      {(pendingRequests.length > 0 || needsOutcome > 0) && (
        <Card className="border-brand/30">
          <CardHeader>
            <CardTitle className="text-lg">Needs attention</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {needsOutcome > 0 && (
              <p>
                {needsOutcome} past interview{needsOutcome === 1 ? "" : "s"} still marked scheduled.{" "}
                <Link href="/recruiter/interviews?view=past" className="text-brand hover:underline">
                  Record outcomes
                </Link>
              </p>
            )}
            {pendingRequests.map((r) => (
              <p key={r.id}>
                {r.companies?.name ?? "An employer"} asked to interview {r.submissions?.candidate_display_name ?? "a candidate"}.{" "}
                <Link href={`/recruiter/interviews/new?request=${r.id}`} className="text-brand hover:underline">
                  Schedule it
                </Link>
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <nav aria-label="Interview views" className="flex gap-2">
        {(["upcoming", "past"] as const).map((v) => (
          <Link
            key={v}
            href={v === "upcoming" ? "/recruiter/interviews" : "/recruiter/interviews?view=past"}
            aria-current={view === v ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1 text-sm", view === v ? "border-brand bg-brand-50 text-ink" : "border-border text-muted-foreground hover:text-foreground")}
          >
            {v === "upcoming" ? "Upcoming" : "Past & closed"}
          </Link>
        ))}
      </nav>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{view === "upcoming" ? "Upcoming" : "Past and closed"}</CardTitle>
          <CardDescription>Times are shown in each interview&apos;s own time zone.</CardDescription>
        </CardHeader>
        <CardContent>
          {interviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No interviews here.</p>
          ) : (
            <ul className="divide-y divide-border">
              {interviews.map((i) => (
                <li key={i.id}>
                  <Link href={`/recruiter/interviews/${i.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 hover:bg-muted/40">
                    <div>
                      <p className="font-medium text-ink">
                        {i.candidates ? fullName(i.candidates) : "Candidate"} · {labelOf(INTERVIEW_KINDS, i.kind)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[i.jobs?.title, i.companies?.name].filter(Boolean).join(" · ")} — {formatInZone(i.starts_at, i.timezone)}
                      </p>
                    </div>
                    <Badge variant={i.status === "scheduled" ? "secondary" : "outline"}>{labelOf(INTERVIEW_STATUS, i.status)}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
