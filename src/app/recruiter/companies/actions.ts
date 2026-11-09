"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getStaffUser } from "@/lib/auth/session";
import { idSchema } from "@/lib/candidates/validation";
import { handleInterviewSchema, reviewJobRequestSchema, zonedLocalToIso } from "@/lib/employer/validation";
import { type FormState, formString } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { emailSchema, toFieldErrors } from "@/lib/validation/auth";

type Staff = { userId: string; supabase: Awaited<ReturnType<typeof createClient>> };

async function staff(): Promise<Staff | FormState> {
  const user = await getStaffUser();
  if (!user) return { status: "error", message: "Only recruiters and administrators can manage companies." };
  return { userId: user.id, supabase: await createClient() };
}

function isStaff(v: Staff | FormState): v is Staff {
  return "supabase" in v;
}

function dbMessage(error: { code?: string; message: string }, fallback: string): string {
  if (["22023", "23505", "42501", "P0002"].includes(error.code ?? "")) return error.message;
  if (error.code === "23514") return "Some values aren't allowed. Check the lengths you entered.";
  console.error("Company action failed", error.code, error.message);
  return fallback;
}

function done(companyId: string, message: string): FormState {
  revalidatePath(`/recruiter/companies/${companyId}`);
  revalidatePath("/recruiter/companies");
  return { status: "success", message };
}

const createCompanySchema = z.object({
  name: z.string().trim().min(1, "Enter the company name.").max(200, "Name must be 200 characters or fewer."),
  website: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.url({ protocol: /^https?$/, error: "Enter a full web address starting with https://" }).optional(),
  ),
  industry: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(120).optional()),
});

export async function createCompany(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await staff();
  if (!isStaff(ctx)) return ctx;
  const values = { name: formString(formData, "name"), website: formString(formData, "website"), industry: formString(formData, "industry") };
  const parsed = createCompanySchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };

  const { data: profile } = await ctx.supabase.from("profiles").select("organization_id").eq("id", ctx.userId).single();
  if (!profile) return { status: "error", message: "The company could not be created." };
  const { data, error } = await ctx.supabase
    .from("companies")
    .insert({
      organization_id: profile.organization_id,
      name: parsed.data.name,
      website: parsed.data.website ?? null,
      industry: parsed.data.industry ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) return { status: "error", message: error ? dbMessage(error, "The company could not be created.") : "The company could not be created.", values };
  revalidatePath("/recruiter/companies");
  redirect(`/recruiter/companies/${data.id}`);
}

const addMemberSchema = z.object({ companyId: idSchema, email: emailSchema, memberRole: z.enum(["owner", "member"]) });

/** Links an existing account (which an administrator has given the employer role) to the company. */
export async function addCompanyMember(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await staff();
  if (!isStaff(ctx)) return ctx;
  const values = { companyId: formString(formData, "companyId"), email: formString(formData, "email"), memberRole: formString(formData, "memberRole") };
  const parsed = addMemberSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };

  const { data: person } = await ctx.supabase.from("profiles").select("id").eq("email", parsed.data.email).maybeSingle();
  if (!person) {
    return {
      status: "error",
      message: "No account uses that email yet. Ask them to sign up first, then an administrator gives them the Employer role at Users.",
      values,
    };
  }
  const { error } = await ctx.supabase.rpc("add_company_member", {
    p_company_id: parsed.data.companyId,
    p_user_id: person.id,
    p_member_role: parsed.data.memberRole,
  });
  if (error) {
    const message =
      error.code === "22023" ? "That account doesn't have the Employer role yet. An administrator can add it at Users." : dbMessage(error, "The member could not be added.");
    return { status: "error", message, values };
  }
  return done(parsed.data.companyId, `${parsed.data.email} now has access to this company.`);
}

export async function removeCompanyMember(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await staff();
  if (!isStaff(ctx)) return ctx;
  const companyId = idSchema.safeParse(formString(formData, "companyId"));
  const userId = idSchema.safeParse(formString(formData, "userId"));
  if (!companyId.success || !userId.success) return { status: "error", message: "Unknown member." };
  const { error } = await ctx.supabase.rpc("remove_company_member", { p_company_id: companyId.data, p_user_id: userId.data });
  if (error) return { status: "error", message: dbMessage(error, "The member could not be removed.") };
  return done(companyId.data, "Access removed.");
}

export async function handleMemberRequest(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await staff();
  if (!isStaff(ctx)) return ctx;
  const companyId = formString(formData, "companyId");
  const status = z.enum(["completed", "dismissed"]).safeParse(formString(formData, "status"));
  const requestId = idSchema.safeParse(formString(formData, "requestId"));
  if (!status.success || !requestId.success) return { status: "error", message: "Unknown request." };
  const { error } = await ctx.supabase.rpc("handle_company_member_request", { p_request_id: requestId.data, p_status: status.data });
  if (error) return { status: "error", message: dbMessage(error, "The request could not be updated.") };
  return done(companyId, status.data === "completed" ? "Marked as done." : "Dismissed.");
}

export async function reviewJobRequest(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await staff();
  if (!isStaff(ctx)) return ctx;
  const companyId = formString(formData, "companyId");
  const parsed = reviewJobRequestSchema.safeParse({
    requestId: formString(formData, "requestId"),
    status: formString(formData, "status"),
    note: formString(formData, "note"),
  });
  if (!parsed.success) {
    const fieldErrors = toFieldErrors(parsed.error);
    return { status: "error", message: Object.values(fieldErrors)[0] ?? "Check the form.", fieldErrors };
  }
  const { error } = await ctx.supabase.rpc("review_job_request", {
    p_request_id: parsed.data.requestId,
    p_status: parsed.data.status,
    p_note: parsed.data.note ?? null,
  });
  if (error) return { status: "error", message: dbMessage(error, "The request could not be updated.") };
  return done(companyId, "Saved.");
}

export async function convertJobRequest(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await staff();
  if (!isStaff(ctx)) return ctx;
  const requestId = idSchema.safeParse(formString(formData, "requestId"));
  if (!requestId.success) return { status: "error", message: "Unknown request." };
  const { data, error } = await ctx.supabase.rpc("convert_job_request", { p_request_id: requestId.data });
  if (error || !data) return { status: "error", message: error ? dbMessage(error, "The job could not be created.") : "The job could not be created." };
  revalidatePath("/recruiter/jobs");
  redirect(`/recruiter/jobs/${data as string}/edit`);
}

export async function shareResume(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await staff();
  if (!isStaff(ctx)) return ctx;
  const companyId = formString(formData, "companyId");
  const submissionId = idSchema.safeParse(formString(formData, "submissionId"));
  const rawResume = formString(formData, "resumeId");
  const resumeId = rawResume ? idSchema.safeParse(rawResume) : null;
  if (!submissionId.success || (resumeId && !resumeId.success)) return { status: "error", message: "Unknown resume." };
  const { error } = await ctx.supabase.rpc("share_resume_with_submission", {
    p_submission_id: submissionId.data,
    p_resume_id: resumeId?.data ?? null,
  });
  if (error) return { status: "error", message: dbMessage(error, "The resume could not be shared.") };
  return done(companyId, resumeId ? "Resume shared with the employer." : "Resume no longer shared.");
}

export async function handleInterviewRequest(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await staff();
  if (!isStaff(ctx)) return ctx;
  const companyId = formString(formData, "companyId");
  const parsed = handleInterviewSchema.safeParse({
    requestId: formString(formData, "requestId"),
    status: formString(formData, "status"),
    confirmedTime: formString(formData, "confirmedTime"),
    note: formString(formData, "note"),
  });
  if (!parsed.success) {
    const fieldErrors = toFieldErrors(parsed.error);
    return { status: "error", message: Object.values(fieldErrors)[0] ?? "Check the form.", fieldErrors };
  }

  // Proposed slots are passed back as ISO strings; a typed time is read in the request's time zone.
  let confirmed: string | null = null;
  if (parsed.data.status === "scheduled" && parsed.data.confirmedTime) {
    const raw = parsed.data.confirmedTime;
    confirmed = /Z$/.test(raw) ? raw : zonedLocalToIso(raw, formString(formData, "timezone") || "America/Chicago");
    if (!confirmed || Number.isNaN(Date.parse(confirmed))) return { status: "error", message: "Enter a valid confirmed time." };
  }

  const { error } = await ctx.supabase.rpc("handle_interview_request", {
    p_request_id: parsed.data.requestId,
    p_status: parsed.data.status,
    p_confirmed_time: confirmed,
    p_note: parsed.data.note ?? null,
  });
  if (error) return { status: "error", message: dbMessage(error, "The interview request could not be updated.") };
  return done(companyId, parsed.data.status === "scheduled" ? "Interview confirmed. The employer can see the time." : "Declined.");
}
