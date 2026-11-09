import { type NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth/session";
import { RESUME_LINK_TTL_SECONDS } from "@/lib/candidates/resume-file";
import { idSchema } from "@/lib/candidates/validation";
import { createClient } from "@/lib/supabase/server";

const NO_STORE = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

/**
 * Employer download of the one resume a recruiter shared with an open submission to their company.
 * get_shared_resume() checks membership and status and audits the view; storage RLS allows only that file.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/employer/submissions/[submissionId]/resume">) {
  const { submissionId } = await ctx.params;

  const user = await getSessionUser();
  if (!user) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", "/employer");
    return NextResponse.redirect(login, { headers: NO_STORE });
  }
  if (!user.roles.includes("employer") || !idSchema.safeParse(submissionId).success) {
    return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_shared_resume", { p_submission_id: submissionId });
  const resume = (data as { storage_path: string; file_name: string }[] | null)?.[0];
  if (error || !resume) return new NextResponse("Not found", { status: 404, headers: NO_STORE });

  const { data: signed, error: signError } = await supabase.storage
    .from("resumes")
    .createSignedUrl(resume.storage_path, RESUME_LINK_TTL_SECONDS, { download: resume.file_name });
  if (signError || !signed?.signedUrl) {
    console.error("Employer signed URL creation failed", signError?.message);
    return new NextResponse("The resume is unavailable right now.", { status: 502, headers: NO_STORE });
  }

  return NextResponse.redirect(signed.signedUrl, { status: 303, headers: NO_STORE });
}
