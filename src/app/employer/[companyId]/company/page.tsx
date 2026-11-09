import type { Metadata } from "next";

import { CompanyProfileForm, MemberControls, TeammateRequestForm } from "@/components/employer/forms";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { getCompanyTeam, getMyCompany } from "@/lib/employer/queries";

export const metadata: Metadata = { title: "Company & team" };

const REQUEST_LABELS: Record<string, string> = { pending: "Waiting for CoreTech", completed: "Added", dismissed: "Not added" };

export default async function EmployerCompanyProfilePage({ params }: PageProps<"/employer/[companyId]/company">) {
  const { companyId } = await params;
  const user = await requireRole(["employer"], `/employer/${companyId}/company`);
  const company = (await getMyCompany(user.id, companyId))!; // the layout already 404s non-members
  const isOwner = company.myRole === "owner";
  const { team, requests } = await getCompanyTeam(companyId, isOwner);

  return (
    <Container className="grid max-w-4xl gap-6 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Company profile</CardTitle>
          <CardDescription>
            {isOwner ? "To change the company name, contact your recruiter." : "Only company owners can edit the profile."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isOwner ? (
            <CompanyProfileForm
              companyId={companyId}
              company={{
                website: company.website ?? "",
                industry: company.industry ?? "",
                headquarters: company.headquarters ?? "",
                about: company.about ?? "",
              }}
            />
          ) : (
            <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-muted-foreground">Website</dt>
              <dd className="break-all">{company.website ?? "—"}</dd>
              <dt className="text-muted-foreground">Industry</dt>
              <dd>{company.industry ?? "—"}</dd>
              <dt className="text-muted-foreground">Headquarters</dt>
              <dd>{company.headquarters ?? "—"}</dd>
              <dt className="text-muted-foreground">About</dt>
              <dd className="whitespace-pre-line">{company.about ?? "—"}</dd>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Team</CardTitle>
          <CardDescription>Everyone here can see your jobs and submitted candidates.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {team.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {m.full_name ?? m.email}
                    {m.user_id === user.id && <span className="text-muted-foreground"> (you)</span>}
                  </p>
                  <p className="text-xs break-all text-muted-foreground">{m.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={m.member_role === "owner" ? "secondary" : "outline"}>{m.member_role === "owner" ? "Owner" : "Member"}</Badge>
                  {isOwner && (
                    <MemberControls companyId={companyId} userId={m.user_id} memberRole={m.member_role} name={m.full_name ?? m.email} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Add a teammate</CardTitle>
            <CardDescription>CoreTech sets up access for new teammates so every account is verified.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <TeammateRequestForm companyId={companyId} />
            {requests.length > 0 && (
              <ul className="divide-y divide-border">
                {requests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span>
                      {r.full_name} <span className="text-muted-foreground">({r.email})</span>
                    </span>
                    <Badge variant="outline">{REQUEST_LABELS[r.status] ?? r.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </Container>
  );
}
