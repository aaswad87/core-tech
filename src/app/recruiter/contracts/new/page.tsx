import type { Metadata } from "next";
import Link from "next/link";

import { AssignmentForm } from "@/components/contracts/forms";
import { Container } from "@/components/layout/container";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { getAssignmentOptions } from "@/lib/contracts/queries";
import { NOT_PAYROLL_NOTICE } from "@/lib/contracts/validation";

export const metadata: Metadata = { title: "New assignment" };

export default async function NewAssignmentPage() {
  await requireRole(["admin"], "/recruiter/contracts/new");
  const { workers, clients } = await getAssignmentOptions();

  return (
    <Container className="grid max-w-3xl gap-6 py-10">
      <div>
        <Link href="/recruiter/contracts" className="text-sm text-muted-foreground hover:text-foreground">
          ← Contract staffing
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">New contract assignment</h1>
        <p className="mt-2 text-sm text-muted-foreground">{NOT_PAYROLL_NOTICE}</p>
      </div>
      {workers.length === 0 || clients.length === 0 ? (
        <p className="text-muted-foreground">Add the worker as a candidate and the client as a company first.</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Assignment details</CardTitle>
            <CardDescription>Starts as pending. Mark it active on the first day.</CardDescription>
          </CardHeader>
          <CardContent>
            <AssignmentForm
              workers={workers}
              clients={clients}
              values={{
                assignmentId: "",
                candidateId: "",
                companyId: "",
                title: "",
                employmentModel: "w2_payroll_provider",
                startDate: "",
                endDate: "",
                billRate: "",
                payRate: "",
                otBillMultiplier: "1.5",
                otPayMultiplier: "1.5",
                burdenPercent: "18",
                clientTermsDays: "30",
                payFrequency: "weekly",
                notes: "",
              }}
            />
          </CardContent>
        </Card>
      )}
    </Container>
  );
}
