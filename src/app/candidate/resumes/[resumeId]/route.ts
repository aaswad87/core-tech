import { type NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth/session";
import { RESUME_LINK_TTL_SECONDS } from "@/lib/candidates/resume-file";
import { idSchema } from "@/lib/candidates/validation";
import { createClient } from "@/lib/supabase/server";

const NO_STORE = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

/**
 * A candidate's own resume download. RLS returns only resumes on the caller's own candidate record;
 * the signed URL is created per click, valid briefly, and never stored or embedded in pages.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/candidate/resumes/[resumeId]">) {
  const { resumeId } = await ctx.params;

  const user = await getSessionUser();
  if (!user) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", "/candidate/profile");
    return NextResponse.redirect(login, { headers: NO_STORE });
  }
  if (!user.roles.includes("candidate") || !idSchema.safeParse(resumeId).success) {
    return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  }

  const supabase = await createClient();
  const { data: own } = await supabase.rpc("my_candidate_profile").maybeSingle<{ id: string }>();
  if (!own) return new NextResponse("Not found", { status: 404, headers: NO_STORE });

  const { data: resume } = await supabase
    .from("candidate_resumes")
    .select("storage_path, file_name")
    .eq("id", resumeId)
    .eq("candidate_id", own.id)
    .maybeSingle();
  if (!resume) return new NextResponse("Not found", { status: 404, headers: NO_STORE });

  const { data, error } = await supabase.storage
    .from("resumes")
    .createSignedUrl(resume.storage_path as string, RESUME_LINK_TTL_SECONDS, { download: resume.file_name as string });
  if (error || !data?.signedUrl) {
    console.error("Candidate signed URL creation failed", error?.message);
    return new NextResponse("Your resume is unavailable right now.", { status: 502, headers: NO_STORE });
  }

  return NextResponse.redirect(data.signedUrl, { status: 303, headers: NO_STORE });
}
