import type { Metadata } from "next";
import Link from "next/link";

import { CreateCompanyForm } from "@/components/companies/staff-forms";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { listCompaniesForStaff } from "@/lib/employer/staff-queries";

export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage() {
  await requireRole(STAFF_ROLES, "/recruiter/companies");
  const companies = await listCompaniesForStaff();
  const waiting = companies.filter((c) => c.pendingJobRequests + c.pendingInterviews + c.pendingMembers > 0);

  return (
    <Container className="grid gap-6 py-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Companies</h1>
        <p className="mt-2 text-muted-foreground">Client companies, their employer-portal users, and requests waiting for you.</p>
      </div>

      {waiting.length > 0 && (
        <Card className="border-brand/30">
          <CardHeader>
            <CardTitle className="text-lg">Waiting for you</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm">
              {waiting.map((c) => (
                <li key={c.id}>
                  <Link href={`/recruiter/companies/${c.id}`} className="font-medium text-brand hover:underline">
                    {c.name}
                  </Link>
                  <span className="text-muted-foreground">
                    {" — "}
                    {[
                      c.pendingJobRequests && `${c.pendingJobRequests} job request${c.pendingJobRequests === 1 ? "" : "s"}`,
                      c.pendingInterviews && `${c.pendingInterviews} interview request${c.pendingInterviews === 1 ? "" : "s"}`,
                      c.pendingMembers && `${c.pendingMembers} teammate request${c.pendingMembers === 1 ? "" : "s"}`,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All companies ({companies.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {companies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No companies yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {companies.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <Link href={`/recruiter/companies/${c.id}`} className="font-medium text-ink hover:text-brand hover:underline">
                    {c.name}
                  </Link>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    {c.industry}
                    {c.is_demo && <Badge variant="outline">Demo data</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add a company</CardTitle>
          <CardDescription>Then give the client&apos;s hiring managers access from the company page.</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateCompanyForm />
        </CardContent>
      </Card>
    </Container>
  );
}
