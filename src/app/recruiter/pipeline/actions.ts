"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getStaffUser } from "@/lib/auth/session";
import { idSchema } from "@/lib/candidates/validation";
import { type FormState, formString } from "@/lib/forms";
import { STAGE_VALUES, stageLabel, stageRequiresReason, SUBMIT_STAGE } from "@/lib/pipeline/stages";
import { createClient } from "@/lib/supabase/server";

const NOT_STAFF: FormState = { status: "error", message: "Only recruiters and administrators can move candidates." };

/** Messages raised by the database functions are written for people; anything else stays generic. */
function dbMessage(error: { code?: string; message: string }): string {
  if (["22023", "42501", "P0002"].includes(error.code ?? "")) return error.message;
  if (error.code === "23505") return "This candidate already has an active application or open submission for this job.";
  return "The change could not be saved. Please try again.";
}

function revalidatePipeline(jobId: string | null) {
  revalidatePath("/recruiter/pipeline");
  if (jobId) revalidatePath(`/recruiter/jobs/${jobId}`);
}

const moveSchema = z.object({
  applicationId: idSchema,
  stage: z.enum(STAGE_VALUES),
  reason: z.string().max(1000, "Keep the reason under 1000 characters.").optional(),
});

/** Moves a card. Submitted to Client is handled by submitToClient (it needs consent). */
export async function moveApplication(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getStaffUser())) return NOT_STAFF;

  const parsed = moveSchema.safeParse({
    applicationId: formString(formData, "applicationId"),
    stage: formString(formData, "stage"),
    reason: formString(formData, "reason").trim() || undefined,
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Choose a stage." };
  const { applicationId, stage, reason } = parsed.data;

  if (stage === SUBMIT_STAGE) return submitToClient(_prev, formData);
  if (stageRequiresReason(stage) && !reason) {
    return { status: "error", fieldErrors: { reason: `Add a reason for moving to ${stageLabel(stage)}.` } };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("move_application_stage", {
    p_application_id: applicationId,
    p_to_stage: stage,
    p_reason: reason ?? null,
  });
  if (error) return { status: "error", message: dbMessage(error) };

  revalidatePipeline(formString(formData, "jobId") || null);
  return { status: "success", message: `Moved to ${stageLabel(stage)}.` };
}

const submitSchema = z.object({
  applicationId: idSchema,
  displayName: z.string().trim().min(1, "Enter the name the employer will see.").max(200),
  sharedSummary: z.string().trim().max(5000, "Keep the summary under 5000 characters.").optional(),
  consent: z.literal("on", { error: "Confirm the candidate agreed to be submitted to this employer." }),
});

/** Creates the employer-visible submission (with recorded consent) and moves the card. */
export async function submitToClient(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getStaffUser())) return NOT_STAFF;

  const parsed = submitSchema.safeParse({
    applicationId: formString(formData, "applicationId"),
    displayName: formString(formData, "displayName"),
    sharedSummary: formString(formData, "sharedSummary") || undefined,
    consent: formString(formData, "consent") || undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { status: "error", fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_application_to_client", {
    p_application_id: parsed.data.applicationId,
    p_display_name: parsed.data.displayName,
    p_shared_summary: parsed.data.sharedSummary ?? null,
    p_consent_confirmed: true,
  });
  if (error) return { status: "error", message: dbMessage(error) };

  revalidatePipeline(formString(formData, "jobId") || null);
  return { status: "success", message: "Submitted to the employer. They'll see only the name and summary you shared." };
}
