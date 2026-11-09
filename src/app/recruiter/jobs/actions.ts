"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getStaffUser } from "@/lib/auth/session";
import { idSchema } from "@/lib/candidates/validation";
import { type FormState, formString } from "@/lib/forms";
import { jobFormSchema, jobStatusLabel, jobStatusSchema, toJobColumns } from "@/lib/jobs/validation";
import { createClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation/auth";

const NOT_STAFF: FormState = { status: "error", message: "Only recruiters and administrators can manage jobs." };
const FAILED: FormState = { status: "error", message: "The job could not be saved. Please try again." };

const FIELDS = [
  "title", "companyId", "newCompanyName", "status", "ownerId", "location", "workArrangement", "employmentType",
  "salaryMin", "salaryMax", "requiredSkills", "preferredSkills", "publicSummary", "publicDescription", "description",
] as const;

function dbMessage(error: { code?: string; message: string }): string {
  if (error.code === "22023" || error.code === "42501") return error.message;
  if (error.code === "23514") return "Some values aren't allowed — check skills, salary and field lengths.";
  return FAILED.message!;
}

export async function saveJob(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getStaffUser();
  if (!user) return NOT_STAFF;

  const values = Object.fromEntries(FIELDS.map((f) => [f, formString(formData, f)])) as Record<(typeof FIELDS)[number], string>;
  const parsed = jobFormSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
  if (!profile) return FAILED;
  const orgId = profile.organization_id as string;

  // Use the chosen company, or create the new one (reusing an exact-name match).
  let companyId = parsed.data.companyId;
  if (!companyId && parsed.data.newCompanyName) {
    const name = parsed.data.newCompanyName;
    const { data: existing } = await supabase
      .from("companies")
      .select("id")
      .ilike("name", name.replace(/[\\%_]/g, (c) => `\\${c}`))
      .limit(1)
      .maybeSingle();
    if (existing) companyId = existing.id as string;
    else {
      const { data: created, error } = await supabase
        .from("companies")
        .insert({ organization_id: orgId, name, created_by: user.id })
        .select("id")
        .single();
      if (error || !created) return { ...FAILED, values };
      companyId = created.id as string;
    }
  }

  const columns = { ...toJobColumns(parsed.data), company_id: companyId! };
  const jobId = formString(formData, "jobId");
  let savedId: string;

  if (jobId) {
    if (!idSchema.safeParse(jobId).success) return { status: "error", message: "Unknown job." };
    const { data, error } = await supabase.from("jobs").update(columns).eq("id", jobId).select("id");
    if (error) return { status: "error", message: dbMessage(error), values };
    if (!data?.length) return { status: "error", message: "This job no longer exists.", values };
    savedId = jobId;
  } else {
    const { data, error } = await supabase
      .from("jobs")
      .insert({ ...columns, owner_id: columns.owner_id ?? user.id, organization_id: orgId, created_by: user.id })
      .select("id")
      .single();
    if (error || !data) return { status: "error", message: error ? dbMessage(error) : FAILED.message, values };
    savedId = data.id as string;
  }

  revalidatePath("/recruiter/jobs");
  revalidatePath(`/recruiter/jobs/${savedId}`);
  revalidatePath("/jobs");
  redirect(`/recruiter/jobs/${savedId}?notice=${jobId ? "saved" : "created"}`);
}

export async function setJobStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getStaffUser();
  if (!user) return NOT_STAFF;
  const id = idSchema.safeParse(formString(formData, "jobId"));
  const status = jobStatusSchema.safeParse(formString(formData, "status"));
  if (!id.success || !status.success) return { status: "error", message: "Unknown action." };

  const supabase = await createClient();
  if (status.data === "published") {
    const { data: job } = await supabase.from("jobs").select("public_summary, public_description").eq("id", id.data).maybeSingle();
    if (job && !job.public_summary && !job.public_description) {
      return { status: "error", message: "Add a public summary (Edit job) before publishing." };
    }
  }
  const { data, error } = await supabase.from("jobs").update({ status: status.data }).eq("id", id.data).select("id");
  if (error) return { status: "error", message: dbMessage(error) };
  if (!data?.length) return { status: "error", message: "This job no longer exists." };

  revalidatePath("/recruiter/jobs");
  revalidatePath(`/recruiter/jobs/${id.data}`);
  revalidatePath("/jobs");
  return { status: "success", message: `Job is now ${jobStatusLabel(status.data).toLowerCase()}.` };
}

export async function addCandidateToJob(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getStaffUser();
  if (!user) return NOT_STAFF;
  const candidateId = idSchema.safeParse(formString(formData, "candidateId"));
  const jobId = idSchema.safeParse(formString(formData, "jobId"));
  if (!candidateId.success) return { status: "error", message: "Choose a candidate." };
  if (!jobId.success) return { status: "error", fieldErrors: { jobId: "Choose a job." } };

  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("organization_id, status").eq("id", jobId.data).maybeSingle();
  if (!job) return { status: "error", message: "This job no longer exists." };
  if (job.status === "closed" || job.status === "archived") return { status: "error", message: "This job is closed." };

  const { error } = await supabase.from("applications").insert({
    organization_id: job.organization_id,
    candidate_id: candidateId.data,
    job_id: jobId.data,
    source: "recruiter",
    created_by: user.id,
  });
  if (error?.code === "23505") return { status: "error", message: "This candidate is already in this job's pipeline." };
  if (error) return { status: "error", message: "The candidate could not be added. Please try again." };

  revalidatePath(`/recruiter/jobs/${jobId.data}`);
  revalidatePath(`/recruiter/candidates/${candidateId.data}`);
  revalidatePath("/recruiter/pipeline");
  return { status: "success", message: "Added to the pipeline as New." };
}
