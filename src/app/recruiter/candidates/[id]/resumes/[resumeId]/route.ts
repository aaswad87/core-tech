import { type NextRequest, NextResponse } from "next/server";

import { getStaffUser } from "@/lib/auth/session";
import { RESUME_LINK_TTL_SECONDS } from "@/lib/candidates/resume-file";
import { idSchema } from "@/lib/candidates/validation";
import { createClient } from "@/lib/supabase/server";

const NO_STORE = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

/**
 * Staff-only resume download. Looks up the resume under RLS, then redirects to a short-lived signed URL.
 * The signed URL is created per click and never stored or embedded in pages.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/recruiter/candidates/[id]/resumes/[resumeId]">) {
  const { id, resumeId } = await ctx.params;

  const user = await getStaffUser();
  if (!user) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `/recruiter/candidates/${id}`);
    return NextResponse.redirect(login, { headers: NO_STORE });
  }

  if (!idSchema.safeParse(id).success || !idSchema.safeParse(resumeId).success) {
    return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  }

  const supabase = await createClient();
  const { data: resume } = await supabase
    .from("candidate_resumes")
    .select("storage_path, file_name")
    .eq("id", resumeId)
    .eq("candidate_id", id)
    .maybeSingle();
  if (!resume) return new NextResponse("Not found", { status: 404, headers: NO_STORE });

  const { data, error } = await supabase.storage
    .from("resumes")
    .createSignedUrl(resume.storage_path as string, RESUME_LINK_TTL_SECONDS, { download: resume.file_name as string });
  if (error || !data?.signedUrl) {
    console.error("Signed URL creation failed", error?.message);
    return new NextResponse("The resume is unavailable right now.", { status: 502, headers: NO_STORE });
  }

  return NextResponse.redirect(data.signedUrl, { status: 303, headers: NO_STORE });
}
