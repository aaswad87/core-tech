"use server";

import { revalidatePath } from "next/cache";

import { getSessionUser } from "@/lib/auth/session";
import { idSchema } from "@/lib/candidates/validation";
import { type FormState, formString } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";

/** Candidate applies to a published job. apply_to_job() enforces role, job status and duplicates. */
export async function applyToJob(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getSessionUser();
  if (!user) return { status: "error", message: "Sign in to apply." };
  if (!user.roles.includes("candidate")) return { status: "error", message: "Only candidate accounts can apply to jobs." };

  const jobId = idSchema.safeParse(formString(formData, "jobId"));
  if (!jobId.success) return { status: "error", message: "Unknown job." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_to_job", { p_job_id: jobId.data });
  if (error) {
    if (["23505", "P0002", "42501"].includes(error.code ?? "")) return { status: "error", message: error.message };
    console.error("Apply failed", error.code, error.message);
    return { status: "error", message: "Your application could not be sent. Please try again." };
  }

  revalidatePath(`/jobs/${jobId.data}`);
  revalidatePath("/account");
  return { status: "success", message: "Application sent. A recruiter will review it and contact you about next steps." };
}

export async function withdrawApplication(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getSessionUser();
  if (!user) return { status: "error", message: "Sign in again to continue." };
  const id = idSchema.safeParse(formString(formData, "applicationId"));
  if (!id.success) return { status: "error", message: "Unknown application." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_my_application", { p_application_id: id.data });
  if (error) {
    if (["22023", "P0002"].includes(error.code ?? "")) return { status: "error", message: error.message };
    return { status: "error", message: "The application could not be withdrawn. Please try again." };
  }
  revalidatePath("/account");
  return { status: "success", message: "Application withdrawn." };
}
