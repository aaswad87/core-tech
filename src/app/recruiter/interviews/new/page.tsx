import type { Metadata } from "next";
import Link from "next/link";

import { ScheduleInterviewForm } from "@/components/interviews/staff-forms";
import { Container } from "@/components/layout/container";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { fullName } from "@/lib/candidates/format";
import { idSchema } from "@/lib/candidates/validation";
import { formatInZone } from "@/lib/employer/validation";
import { isEmailConfigured } from "@/lib/interviews/notify-server";
import { getSchedulingContext } from "@/lib/interviews/staff-queries";
import { hasStarted, INTERVIEW_KINDS, toZonedLocalInput } from "@/lib/interviews/validation";
import { stageLabel } from "@/lib/pipeline/stages";

export const metadata: Metadata = { title: "Schedule interview" };

export default async function NewInterviewPage({ searchParams }: PageProps<"/recruiter/interviews/new">) {
  await requireRole(STAFF_ROLES, "/recruiter/interviews/new");
  const { application, request } = await searchParams;
  const applicationId = typeof application === "string" && idSchema.safeParse(application).success ? application : undefined;
  const requestId = typeof request === "string" && idSchema.safeParse(request).success ? request : undefined;
  const ctx = applicationId || requestId ? await getSchedulingContext({ applicationId, requestId }) : null;

  if (!ctx) {
    return (
      <Container className="max-w-3xl py-10">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Schedule an interview</h1>
        <p className="mt-4 text-muted-foreground">
          Open a candidate and choose <strong>Schedule interview</strong> next to one of their applications, or schedule from an employer&apos;s request on the{" "}
          <Link href="/recruiter/interviews" className="text-brand hover:underline">
            Interviews
          </Link>{" "}
          page.
        </p>
      </Container>
    );
  }

  const { application: app, request: req } = ctx;
  const candidateName = app.candidates ? fullName(app.candidates) : "Candidate";
  const kinds = req ? INTERVIEW_KINDS.filter((k) => k.value === "client" || k.value === "final") : INTERVIEW_KINDS;
  const proposed = (req?.proposed_times ?? [])
    .filter((t) => !hasStarted(t))
    .map((t) => ({ value: toZonedLocalInput(t, req!.timezone), label: formatInZone(t, req!.timezone) }));

  return (
    <Container className="grid max-w-3xl gap-6 py-10">
      <div>
        <Link href={app.candidates ? `/recruiter/candidates/${app.candidates.id}` : "/recruiter/interviews"} className="text-sm text-muted-foreground hover:text-foreground">
          ← {candidateName}
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Schedule an interview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {candidateName} · {[app.jobs?.title, app.jobs?.companies?.name].filter(Boolean).join(" · ")} · {stageLabel(app.stage)}
        </p>
      </div>

      {app.status !== "active" ? (
        <p role="alert" className="text-sm text-destructive">This application is closed, so no interview can be scheduled.</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Interview details</CardTitle>
            <CardDescription>
              {req
                ? "From the employer's interview request. Confirm the time with the candidate before saving."
                : "Client and final interviews are shared with the employer when the candidate has been submitted to them."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {req?.notes && <p className="mb-4 rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-line">Employer notes: {req.notes}</p>}
            <ScheduleInterviewForm
              kinds={kinds}
              emailReady={isEmailConfigured()}
              proposedTimes={proposed}
              defaults={{
                applicationId: app.id,
                interviewRequestId: req?.id,
                kind: req ? "client" : "recruiter_screen",
                format: req?.format ?? "video",
                startsAtLocal: proposed[0]?.value,
                durationMinutes: req ? String(req.duration_minutes) : "60",
                timezone: req?.timezone ?? "America/Chicago",
                interviewers: req?.interviewers ?? undefined,
              }}
            />
          </CardContent>
        </Card>
      )}
    </Container>
  );
}
