import { DownloadIcon, FileTextIcon } from "lucide-react";
import type { Metadata } from "next";

import { ProfileForm, RemoveResumeButton, ResumeUploadForm } from "@/components/candidate-portal/forms";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { formatBytes } from "@/lib/candidates/format";
import { loadMyPortal } from "@/lib/candidates/portal-queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Profile & resume" };

const uploadedDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Chicago" });

export default async function CandidateProfilePage() {
  const user = await requireRole(["candidate"], "/candidate/profile");
  const supabase = await createClient();
  const portal = await loadMyPortal(supabase, user.id);
  const ownCount = portal.resumes.filter((r) => r.uploaded_by === user.id).length;

  return (
    <Container className="grid max-w-3xl gap-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Profile &amp; resume</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your details</CardTitle>
          <CardDescription>Recruiters use these to match you with roles. Employers see them only after you agree to be submitted for a specific job.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm profile={portal.profile} email={portal.email || user.email || ""} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Resumes</CardTitle>
          <CardDescription>Stored privately. Only you and CoreTech recruiters can open them.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {portal.resumes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No resume on file yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {portal.resumes.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <FileTextIcon className="size-5 shrink-0 text-brand" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{r.file_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(r.size_bytes)} · added {uploadedDate.format(new Date(r.created_at))}
                      </p>
                    </div>
                    {r.uploaded_by !== user.id && <Badge variant="outline">Added by a recruiter</Badge>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button asChild variant="ghost" size="sm">
                      <a href={`/candidate/resumes/${r.id}`} rel="noreferrer">
                        <DownloadIcon aria-hidden="true" />
                        Download<span className="sr-only"> {r.file_name}</span>
                      </a>
                    </Button>
                    {r.uploaded_by === user.id && <RemoveResumeButton resumeId={r.id} fileName={r.file_name} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <ResumeUploadForm disabled={ownCount >= 5} />
        </CardContent>
      </Card>
    </Container>
  );
}
