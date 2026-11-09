"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getStaffUser } from "@/lib/auth/session";
import { type FormState, formString } from "@/lib/forms";
import { sendInterviewEmail } from "@/lib/interviews/notify-server";
import { cancelSchema, interviewFeedbackSchema, outcomeSchema, rescheduleSchema, scheduleSchema } from "@/lib/interviews/validation";
import { createClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation/auth";

function dbMessage(error: { code?: string; message: string }, fallback: string): string {
  if (["22023", "23505", "42501", "P0002"].includes(error.code ?? "")) return error.message;
  if (error.code === "23514") return "Some values aren't allowed. Check the link, address and lengths.";
  console.error("Interview action failed", error.code, error.message);
  return fallback;
}

function read<K extends string>(formData: FormData, keys: readonly K[]): Record<K, string> {
  return Object.fromEntries(keys.map((k) => [k, formString(formData, k)])) as Record<K, string>;
}

function refresh(interviewId?: string) {
  revalidatePath("/recruiter/interviews");
  if (interviewId) revalidatePath(`/recruiter/interviews/${interviewId}`);
}

const SCHEDULE_FIELDS = [
  "applicationId", "interviewRequestId", "kind", "format", "startsAtLocal", "durationMinutes", "timezone",
  "meetingUrl", "location", "interviewers", "instructions", "notifyCandidate",
] as const;

export async function scheduleInterview(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getStaffUser())) return { status: "error", message: "Only recruiters and administrators can schedule interviews." };
  const values = read(formData, SCHEDULE_FIELDS);
  const parsed = scheduleSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };

  const d = parsed.data;
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("schedule_interview", {
    p_application_id: d.applicationId,
    p_kind: d.kind,
    p_format: d.format,
    p_starts_at: d.startsAt,
    p_duration_minutes: d.durationMinutes,
    p_timezone: d.timezone,
    p_meeting_url: d.meetingUrl ?? null,
    p_location: d.location ?? null,
    p_interviewers: d.interviewers ?? null,
    p_instructions: d.instructions ?? null,
    p_interview_request_id: d.interviewRequestId ?? null,
  });
  if (error || !id) return { status: "error", message: error ? dbMessage(error, "The interview could not be scheduled.") : "The interview could not be scheduled.", values };

  const interviewId = id as string;
  const email = d.notifyCandidate ? await sendInterviewEmail(supabase, interviewId, "scheduled") : null;
  refresh(interviewId);
  revalidatePath("/recruiter/companies", "layout");
  redirect(`/recruiter/interviews/${interviewId}?notice=scheduled${email ? `&email=${email.status}` : ""}`);
}

export async function rescheduleInterview(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getStaffUser())) return { status: "error", message: "Only recruiters and administrators can change interviews." };
  const values = read(formData, ["interviewId", "format", "startsAtLocal", "durationMinutes", "timezone", "meetingUrl", "location", "reason", "notifyCandidate"] as const);
  const parsed = rescheduleSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };

  const d = parsed.data;
  const supabase = await createClient();
  const { data: before } = await supabase.from("interviews").select("starts_at").eq("id", d.interviewId).maybeSingle();
  const { error } = await supabase.rpc("reschedule_interview", {
    p_interview_id: d.interviewId,
    p_starts_at: d.startsAt,
    p_duration_minutes: d.durationMinutes,
    p_timezone: d.timezone,
    p_meeting_url: d.meetingUrl ?? null,
    p_location: d.location ?? null,
    p_reason: d.reason,
  });
  if (error) return { status: "error", message: dbMessage(error, "The interview could not be rescheduled."), values };

  const email = d.notifyCandidate
    ? await sendInterviewEmail(supabase, d.interviewId, "rescheduled", { previousStartsAt: (before?.starts_at as string | undefined) ?? null })
    : null;
  refresh(d.interviewId);
  return { status: email?.status === "failed" ? "error" : "success", message: ["Interview rescheduled.", email?.message].filter(Boolean).join(" ") };
}

export async function cancelInterview(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getStaffUser())) return { status: "error", message: "Only recruiters and administrators can change interviews." };
  const values = read(formData, ["interviewId", "reason", "notifyCandidate"] as const);
  const parsed = cancelSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_scheduled_interview", { p_interview_id: parsed.data.interviewId, p_reason: parsed.data.reason });
  if (error) return { status: "error", message: dbMessage(error, "The interview could not be cancelled."), values };

  const email = parsed.data.notifyCandidate ? await sendInterviewEmail(supabase, parsed.data.interviewId, "cancelled", { reason: parsed.data.reason }) : null;
  refresh(parsed.data.interviewId);
  return { status: email?.status === "failed" ? "error" : "success", message: ["Interview cancelled.", email?.message].filter(Boolean).join(" ") };
}

export async function recordOutcome(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getStaffUser())) return { status: "error", message: "Only recruiters and administrators can record outcomes." };
  const values = read(formData, ["interviewId", "status", "outcome", "summary"] as const);
  const parsed = outcomeSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_interview_outcome", {
    p_interview_id: parsed.data.interviewId,
    p_status: parsed.data.status,
    p_outcome: parsed.data.outcome ?? null,
    p_summary: parsed.data.summary ?? null,
  });
  if (error) return { status: "error", message: dbMessage(error, "The outcome could not be saved."), values };
  refresh(parsed.data.interviewId);
  return { status: "success", message: "Outcome saved. Move the candidate in the pipeline if the next step is decided." };
}

export async function addStaffInterviewFeedback(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getStaffUser())) return { status: "error", message: "Only recruiters and administrators can add feedback here." };
  const values = read(formData, ["interviewId", "rating", "recommendation", "body"] as const);
  const parsed = interviewFeedbackSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_interview_feedback", {
    p_interview_id: parsed.data.interviewId,
    p_rating: parsed.data.rating ?? null,
    p_recommendation: parsed.data.recommendation ?? null,
    p_body: parsed.data.body,
  });
  if (error) return { status: "error", message: dbMessage(error, "The feedback could not be saved."), values };
  refresh(parsed.data.interviewId);
  return { status: "success", message: "Feedback saved." };
}
