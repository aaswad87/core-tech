import type { Metadata } from "next";
import Link from "next/link";

import { PlacementTermsForm } from "@/components/finance/forms";
import { Container } from "@/components/layout/container";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { fullName } from "@/lib/candidates/format";
import { idSchema } from "@/lib/candidates/validation";
import { getApplicationForPlacement } from "@/lib/finance/queries";
import { stageLabel } from "@/lib/pipeline/stages";

export const metadata: Metadata = { title: "Record placement" };

export default async function NewPlacementPage({ searchParams }: PageProps<"/recruiter/finance/placements/new">) {
  await requireRole(["admin"], "/recruiter/finance/placements/new");
  const { application } = await searchParams;
  const app = typeof application === "string" && idSchema.safeParse(application).success ? await getApplicationForPlacement(application) : null;

  return (
    <Container className="grid max-w-3xl gap-6 py-10">
      <div>
        <Link href="/recruiter/finance" className="text-sm text-muted-foreground hover:text-foreground">
          ← Finance
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Record a placement</h1>
      </div>
      {!app ? (
        <p className="text-muted-foreground">
          Choose an offer or hire from the{" "}
          <Link href="/recruiter/finance" className="text-brand hover:underline">
            Finance
          </Link>{" "}
          page or a candidate&apos;s Applications list.
        </p>
      ) : app.stage !== "offer" && app.stage !== "placed" ? (
        <p role="alert" className="text-sm text-destructive">
          This application is at {stageLabel(app.stage)}. Move it to Offer or Placed in the pipeline first.
        </p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {app.candidates ? fullName(app.candidates) : "Candidate"} · {app.jobs?.title}
            </CardTitle>
            <CardDescription>{app.jobs?.companies?.name} · use the terms in the signed fee agreement.</CardDescription>
          </CardHeader>
          <CardContent>
            <PlacementTermsForm
              mode="create"
              id={app.id}
              terms={{
                offerAcceptedOn: "",
                startDate: "",
                baseSalary: app.jobs?.salary_max ? String(app.jobs.salary_max) : "",
                feeType: "percentage",
                feePercent: "20",
                feeFlat: "",
                guaranteeDays: "90",
                notes: "",
              }}
            />
          </CardContent>
        </Card>
      )}
    </Container>
  );
}
