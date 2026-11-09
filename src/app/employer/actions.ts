"use server";

import { revalidatePath } from "next/cache";

import { getSessionUser } from "@/lib/auth/session";
import {
  companyProfileSchema,
  feedbackSchema,
  interviewRequestSchema,
  jobRequestSchema,
  memberRequestSchema,
  memberRoleSchema,
  submissionResponseSchema,
} from "@/lib/employer/validation";
import { type FormState, formString } from "@/lib/forms";
import { interviewFeedbackSchema } from "@/lib/interviews/validation";
import { createClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation/auth";

/**
 * Employer accounts only. Every database function re-checks company membership (and ownership where
 * needed), so these checks only give clearer messages.
 */
async function employerClient(): Promise<{ supabase: Awaited<ReturnType<typeof createClient>> } | FormState> {
  const user = await getSessionUser();
  if (!user) return { status: "error", message: "Sign in again to continue." };
  if (!user.roles.includes("employer")) return { status: "error", message: "This page is for employer accounts." };
  return { supabase: await createClient() };
}

function isClient(v: { supabase: unknown } | FormState): v is { supabase: Awaited<ReturnType<typeof createClient>> } {
  return "supabase" in v;
}

/** Messages our database functions raise on purpose; anything else stays generic and is logged. */
function dbMessage(error: { code?: string; message: string }, fallback: string): string {
  if (["22023", "23505", "42501", "P0002"].includes(error.code ?? "")) return error.message;
  if (error.code === "23514") return "Some values aren't allowed. Check the lengths and numbers you entered.";
  console.error("Employer action failed", error.code, error.message);
  return fallback;
}

function read<K extends string>(formData: FormData, keys: readonly K[]): Record<K, string> {
  return Object.fromEntries(keys.map((k) => [k, formString(formData, k)])) as Record<K, string>;
}

function refresh(companyId: string) {
  revalidatePath(`/employer/${companyId}`, "layout");
}

// --- Company profile and team -----------------------------------------------

export async function updateCompanyProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await employerClient();
  if (!isClient(ctx)) return ctx;
  const values = read(formData, ["companyId", "website", "industry", "headquarters", "about"] as const);
  const parsed = companyProfileSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };

  const { error } = await ctx.supabase.rpc("update_my_company", {
    p_company_id: parsed.data.companyId,
    p_website: parsed.data.website ?? null,
    p_industry: parsed.data.industry ?? null,
    p_headquarters: parsed.data.headquarters ?? null,
    p_about: parsed.data.about ?? null,
  });
  if (error) return { status: "error", message: dbMessage(error, "The company profile could not be saved."), values };
  refresh(parsed.data.companyId);
  return { status: "success", message: "Company profile saved." };
}

export async function requestTeammate(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await employerClient();
  if (!isClient(ctx)) return ctx;
  const values = read(formData, ["companyId", "fullName", "email", "memberRole"] as const);
  const parsed = memberRequestSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };

  const { error } = await ctx.supabase.rpc("request_company_member", {
    p_company_id: parsed.data.companyId,
    p_full_name: parsed.data.fullName,
    p_email: parsed.data.email,
    p_member_role: parsed.data.memberRole,
  });
  if (error) return { status: "error", message: dbMessage(error, "The request could not be sent."), values };
  refresh(parsed.data.companyId);
  return { status: "success", message: `Request sent. CoreTech will set up access for ${parsed.data.email} and let them know.` };
}

export async function changeMemberRole(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await employerClient();
  if (!isClient(ctx)) return ctx;
  const parsed = memberRoleSchema.safeParse(read(formData, ["companyId", "userId", "memberRole"] as const));
  if (!parsed.success) return { status: "error", message: "Choose a role." };
  const { error } = await ctx.supabase.rpc("set_company_member_role_as_owner", {
    p_company_id: parsed.data.companyId,
    p_user_id: parsed.data.userId,
    p_member_role: parsed.data.memberRole,
  });
  if (error) return { status: "error", message: dbMessage(error, "The role could not be changed.") };
  refresh(parsed.data.companyId);
  return { status: "success", message: "Role updated." };
}

export async function removeTeammate(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await employerClient();
  if (!isClient(ctx)) return ctx;
  const parsed = memberRoleSchema.pick({ companyId: true, userId: true }).safeParse(read(formData, ["companyId", "userId"] as const));
  if (!parsed.success) return { status: "error", message: "Unknown team member." };
  const { error } = await ctx.supabase.rpc("remove_company_member_as_owner", { p_company_id: parsed.data.companyId, p_user_id: parsed.data.userId });
  if (error) return { status: "error", message: dbMessage(error, "The team member could not be removed.") };
  refresh(parsed.data.companyId);
  return { status: "success", message: "Removed from the team." };
}

// --- Job requests -----------------------------------------------------------

const JOB_REQUEST_FIELDS = [
  "companyId", "title", "location", "workArrangement", "employmentType", "openings",
  "salaryMin", "salaryMax", "targetStart", "description", "mustHaveSkills",
] as const;

export async function submitJobRequest(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await employerClient();
  if (!isClient(ctx)) return ctx;
  const values = read(formData, JOB_REQUEST_FIELDS);
  const parsed = jobRequestSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };

  const d = parsed.data;
  const { error } = await ctx.supabase.rpc("submit_job_request", {
    p_company_id: d.companyId,
    p_title: d.title,
    p_location: d.location ?? null,
    p_work_arrangement: d.workArrangement ?? null,
    p_employment_type: d.employmentType,
    p_openings: d.openings,
    p_salary_min: d.salaryMin ?? null,
    p_salary_max: d.salaryMax ?? null,
    p_target_start: d.targetStart ?? null,
    p_description: d.description,
    p_must_have_skills: d.mustHaveSkills ?? null,
  });
  if (error) return { status: "error", message: dbMessage(error, "The job request could not be sent."), values };
  refresh(d.companyId);
  return { status: "success", message: "Job request sent. A CoreTech recruiter will review it and follow up." };
}

export async function cancelJobRequest(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await employerClient();
  if (!isClient(ctx)) return ctx;
  const ids = memberRoleSchema.pick({ companyId: true }).safeParse({ companyId: formString(formData, "companyId") });
  const requestId = formString(formData, "requestId");
  if (!ids.success || !requestId) return { status: "error", message: "Unknown request." };
  const { error } = await ctx.supabase.rpc("cancel_job_request", { p_request_id: requestId });
  if (error) return { status: "error", message: dbMessage(error, "The request could not be cancelled.") };
  refresh(ids.data.companyId);
  return { status: "success", message: "Request cancelled." };
}

// --- Submissions ------------------------------------------------------------

export async function respondToSubmission(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await employerClient();
  if (!isClient(ctx)) return ctx;
  const companyId = formString(formData, "companyId");
  const parsed = submissionResponseSchema.safeParse(read(formData, ["submissionId", "status"] as const));
  if (!parsed.success) return { status: "error", message: "Choose a response." };
  const { error } = await ctx.supabase.rpc("respond_to_submission", { p_submission_id: parsed.data.submissionId, p_status: parsed.data.status });
  if (error) return { status: "error", message: dbMessage(error, "Your response could not be saved.") };
  refresh(companyId);
  return {
    status: "success",
    message: parsed.data.status === "declined" ? "Marked as not moving forward. Your recruiter has been told." : "Marked as under review.",
  };
}

export async function addFeedback(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await employerClient();
  if (!isClient(ctx)) return ctx;
  const companyId = formString(formData, "companyId");
  const values = read(formData, ["submissionId", "rating", "body"] as const);
  const parsed = feedbackSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };
  const { error } = await ctx.supabase.rpc("add_submission_feedback", {
    p_submission_id: parsed.data.submissionId,
    p_rating: parsed.data.rating ?? null,
    p_body: parsed.data.body,
  });
  if (error) return { status: "error", message: dbMessage(error, "Your feedback could not be saved."), values };
  refresh(companyId);
  return { status: "success", message: "Feedback shared with CoreTech." };
}

export async function requestInterview(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await employerClient();
  if (!isClient(ctx)) return ctx;
  const companyId = formString(formData, "companyId");
  const values = read(formData, ["submissionId", "format", "durationMinutes", "timezone", "slot1", "slot2", "slot3", "interviewers", "notes"] as const);
  const parsed = interviewRequestSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };

  const d = parsed.data;
  const { error } = await ctx.supabase.rpc("request_interview", {
    p_submission_id: d.submissionId,
    p_format: d.format,
    p_duration_minutes: d.durationMinutes,
    p_timezone: d.timezone,
    p_proposed_times: d.proposedTimes,
    p_interviewers: d.interviewers ?? null,
    p_notes: d.notes ?? null,
  });
  if (error) return { status: "error", message: dbMessage(error, "The interview request could not be sent."), values };
  refresh(companyId);
  return { status: "success", message: "Interview request sent. CoreTech will confirm a time with the candidate." };
}

export async function addInterviewFeedback(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await employerClient();
  if (!isClient(ctx)) return ctx;
  const companyId = formString(formData, "companyId");
  const values = read(formData, ["interviewId", "rating", "recommendation", "body"] as const);
  const parsed = interviewFeedbackSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };
  const { error } = await ctx.supabase.rpc("add_interview_feedback", {
    p_interview_id: parsed.data.interviewId,
    p_rating: parsed.data.rating ?? null,
    p_recommendation: parsed.data.recommendation ?? null,
    p_body: parsed.data.body,
  });
  if (error) return { status: "error", message: dbMessage(error, "Your feedback could not be saved."), values };
  refresh(companyId);
  return { status: "success", message: "Interview feedback shared with CoreTech." };
}

export async function reviewTimesheet(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await employerClient();
  if (!isClient(ctx)) return ctx;
  const companyId = formString(formData, "companyId");
  const approve = formString(formData, "approve") === "true";
  const note = formString(formData, "note").trim();
  if (!approve && !note) return { status: "error", message: "Say what needs to change so CoreTech can correct it." };
  if (note.length > 1000) return { status: "error", message: "Keep the note under 1000 characters." };
  const { error } = await ctx.supabase.rpc("review_timesheet", {
    p_timesheet_id: formString(formData, "timesheetId"),
    p_approve: approve,
    p_note: note || null,
  });
  if (error) return { status: "error", message: dbMessage(error, "Your decision could not be saved.") };
  refresh(companyId);
  return { status: "success", message: approve ? "Approved." : "Sent back to CoreTech with your note." };
}

export async function cancelInterview(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await employerClient();
  if (!isClient(ctx)) return ctx;
  const companyId = formString(formData, "companyId");
  const requestId = formString(formData, "requestId");
  if (!requestId) return { status: "error", message: "Unknown request." };
  const { error } = await ctx.supabase.rpc("cancel_interview_request", { p_request_id: requestId });
  if (error) return { status: "error", message: dbMessage(error, "The interview request could not be cancelled.") };
  refresh(companyId);
  return { status: "success", message: "Interview request cancelled." };
}
