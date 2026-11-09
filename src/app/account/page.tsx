import type { Metadata } from "next";
import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { WithdrawButton } from "@/components/jobs/apply-controls";
import { FormMessage } from "@/components/forms/form-message";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isAdmin, isStaff, ROLE_LABELS } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

const appliedDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Chicago" });

const NOTICES: Record<string, string> = {
  "password-updated": "Your password has been updated.",
};

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const user = await requireUser("/account");
  const { notice } = await searchParams;
  const noticeMessage = typeof notice === "string" ? NOTICES[notice] : undefined;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, created_at")
    .eq("id", user.id)
    .maybeSingle();

  // Candidate-facing view: simplified status only, never internal stage names or recruiter reasons.
  const { data: applicationRows, error: applicationsError } = user.roles.includes("candidate")
    ? await supabase.rpc("my_applications")
    : { data: [], error: null };
  const applications = (applicationRows ?? []) as {
    id: string;
    job_id: string;
    job_title: string;
    job_is_open: boolean;
    status_label: string;
    applied_at: string;
    can_withdraw: boolean;
  }[];

  return (
    <Container className="max-w-3xl py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Your account</h1>
        <SignOutButton size="lg" />
      </div>

      {noticeMessage && (
        <div className="mt-6">
          <FormMessage state={{ status: "success", message: noticeMessage }} />
        </div>
      )}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-lg">Profile</CardTitle>
          <CardDescription>Your sign-in details.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <dt className="text-sm font-medium text-muted-foreground">Name</dt>
            <dd>{profile?.full_name ?? "Not provided"}</dd>
            <dt className="text-sm font-medium text-muted-foreground">Email</dt>
            <dd className="break-all">{profile?.email ?? user.email}</dd>
            <dt className="text-sm font-medium text-muted-foreground">Roles</dt>
            <dd className="flex flex-wrap gap-2">
              {user.roles.length > 0 ? (
                user.roles.map((role) => (
                  <Badge key={role} variant="secondary">
                    {ROLE_LABELS[role]}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground">
                  No role assigned yet. A CoreTech administrator will set up your access.
                </span>
              )}
            </dd>
          </dl>
        </CardContent>
      </Card>

      {user.roles.includes("employer") && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg">Employer portal</CardTitle>
            <CardDescription>Review candidates CoreTech has submitted, request interviews and new jobs, and manage your team.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/employer">Open employer portal</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {user.roles.includes("candidate") && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg">Candidate portal</CardTitle>
            <CardDescription>Edit your profile, upload your resume, set job preferences and manage privacy requests.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/candidate/profile">Edit profile &amp; resume</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/candidate">Open candidate portal</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {user.roles.includes("candidate") && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg">Your applications</CardTitle>
            <CardDescription>Jobs you&apos;ve applied to through this site.</CardDescription>
          </CardHeader>
          <CardContent>
            {applicationsError ? (
              <p role="alert" className="text-sm text-destructive">Your applications couldn&apos;t be loaded. Please refresh the page.</p>
            ) : applications.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You haven&apos;t applied to any jobs yet.{" "}
                <Link href="/jobs" className="text-brand hover:underline">
                  Browse open jobs
                </Link>
                .
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {applications.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      {a.job_is_open ? (
                        <Link href={`/jobs/${a.job_id}`} className="font-medium text-ink hover:text-brand hover:underline">
                          {a.job_title}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink">{a.job_title}</span>
                      )}
                      <p className="text-xs text-muted-foreground">Applied {appliedDate.format(new Date(a.applied_at))}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={a.status_label === "In progress" ? "secondary" : "outline"}>{a.status_label}</Badge>
                      {a.can_withdraw && <WithdrawButton applicationId={a.id} jobTitle={a.job_title} />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {isStaff(user.roles) && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg">Staff tools</CardTitle>
            <CardDescription>Candidates, jobs, the pipeline, website inquiries and, for administrators, user access.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/recruiter/candidates">Candidates</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/recruiter/jobs">Jobs</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/recruiter/pipeline">Pipeline</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/leads">Leads inbox</Link>
            </Button>
            {isAdmin(user.roles) && (
              <Button asChild variant="outline">
                <Link href="/admin/users">Manage users and roles</Link>
              </Button>
            )}
            {isAdmin(user.roles) && (
              <Button asChild variant="outline">
                <Link href="/admin/privacy">Privacy requests</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </Container>
  );
}
