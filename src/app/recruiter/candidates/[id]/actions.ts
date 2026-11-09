"use server";

import { revalidatePath } from "next/cache";

import { getStaffUser } from "@/lib/auth/session";
import { checkResumeFile, MAX_RESUME_BYTES } from "@/lib/candidates/resume-file";
import {
  certificationSchema,
  idSchema,
  noteSchema,
  skillSchema,
  workHistorySchema,
} from "@/lib/candidates/validation";
import { type FormState, formString } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation/auth";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Context = { userId: string; supabase: Supabase; candidateId: string; organizationId: string };

const SAVE_FAILED: FormState = { status: "error", message: "That change could not be saved. Please try again." };

/**
 * Shared guard for every candidate sub-resource action: staff role, valid candidate id, and a candidate
 * the caller can see under RLS. RLS policies remain the enforcement point for the write itself.
 */
async function candidateContext(formData: FormData): Promise<Context | FormState> {
  const user = await getStaffUser();
  if (!user) return { status: "error", message: "Only recruiters and administrators can change candidate records." };

  const id = idSchema.safeParse(formString(formData, "candidateId"));
  if (!id.success) return { status: "error", message: "Unknown candidate." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("candidates").select("organization_id").eq("id", id.data).maybeSingle();
  if (error) return SAVE_FAILED;
  if (!data) return { status: "error", message: "This candidate no longer exists or you can't access it." };

  return { userId: user.id, supabase, candidateId: id.data, organizationId: data.organization_id as string };
}

function isContext(value: Context | FormState): value is Context {
  return "supabase" in value;
}

function done(candidateId: string, message: string): FormState {
  revalidatePath(`/recruiter/candidates/${candidateId}`);
  return { status: "success", message };
}

async function removeRow(
  formData: FormData,
  table: "candidate_skills" | "candidate_certifications" | "candidate_work_history",
  message: string,
): Promise<FormState> {
  const ctx = await candidateContext(formData);
  if (!isContext(ctx)) return ctx;
  const rowId = idSchema.safeParse(formString(formData, "rowId"));
  if (!rowId.success) return { status: "error", message: "Unknown item." };

  const { data, error } = await ctx.supabase
    .from(table)
    .delete()
    .eq("id", rowId.data)
    .eq("candidate_id", ctx.candidateId)
    .select("id");
  if (error || !data?.length) return { status: "error", message: "That item could not be removed." };
  return done(ctx.candidateId, message);
}

// --- Skills -----------------------------------------------------------------

export async function addSkill(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await candidateContext(formData);
  if (!isContext(ctx)) return ctx;

  const values = { name: formString(formData, "name"), yearsExperience: formString(formData, "yearsExperience") };
  const parsed = skillSchema.safeParse(values);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values };

  const { error } = await ctx.supabase.from("candidate_skills").insert({
    organization_id: ctx.organizationId,
    candidate_id: ctx.candidateId,
    name: parsed.data.name,
    years_experience: parsed.data.yearsExperience ?? null,
    created_by: ctx.userId,
  });
  if (error?.code === "23505") return { status: "error", fieldErrors: { name: "This skill is already listed." }, values };
  if (error) return { ...SAVE_FAILED, values };
  return done(ctx.candidateId, `Added ${parsed.data.name}.`);
}

export async function removeSkill(_prev: FormState, formData: FormData): Promise<FormState> {
  return removeRow(formData, "candidate_skills", "Skill removed.");
}

// --- Certifications ---------------------------------------------------------

export async function addCertification(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await candidateContext(formData);
  if (!isContext(ctx)) return ctx;

  const values = Object.fromEntries(
    ["name", "issuer", "credentialId", "issuedOn", "expiresOn"].map((k) => [k, formString(formData, k)]),
  );
  const parsed = certificationSchema.safeParse(values);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values };

  const { error } = await ctx.supabase.from("candidate_certifications").insert({
    organization_id: ctx.organizationId,
    candidate_id: ctx.candidateId,
    name: parsed.data.name,
    issuer: parsed.data.issuer ?? null,
    credential_id: parsed.data.credentialId ?? null,
    issued_on: parsed.data.issuedOn ?? null,
    expires_on: parsed.data.expiresOn ?? null,
    created_by: ctx.userId,
  });
  if (error) return { ...SAVE_FAILED, values };
  return done(ctx.candidateId, `Added ${parsed.data.name}.`);
}

export async function removeCertification(_prev: FormState, formData: FormData): Promise<FormState> {
  return removeRow(formData, "candidate_certifications", "Certification removed.");
}

// --- Work history -----------------------------------------------------------

export async function addWorkHistory(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await candidateContext(formData);
  if (!isContext(ctx)) return ctx;

  const values = Object.fromEntries(
    ["companyName", "title", "location", "startDate", "endDate", "isCurrent", "description"].map((k) => [k, formString(formData, k)]),
  );
  const parsed = workHistorySchema.safeParse(values);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values };

  const { error } = await ctx.supabase.from("candidate_work_history").insert({
    organization_id: ctx.organizationId,
    candidate_id: ctx.candidateId,
    company_name: parsed.data.companyName,
    title: parsed.data.title,
    location: parsed.data.location ?? null,
    start_date: parsed.data.startDate ?? null,
    end_date: parsed.data.endDate ?? null,
    is_current: parsed.data.isCurrent,
    description: parsed.data.description ?? null,
    created_by: ctx.userId,
  });
  if (error) return { ...SAVE_FAILED, values };
  return done(ctx.candidateId, `Added ${parsed.data.title} at ${parsed.data.companyName}.`);
}

export async function removeWorkHistory(_prev: FormState, formData: FormData): Promise<FormState> {
  return removeRow(formData, "candidate_work_history", "Work history entry removed.");
}

// --- Internal notes ---------------------------------------------------------

export async function addNote(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await candidateContext(formData);
  if (!isContext(ctx)) return ctx;

  const values = { body: formString(formData, "body") };
  const parsed = noteSchema.safeParse(values);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values };

  const { error } = await ctx.supabase.from("candidate_notes").insert({
    organization_id: ctx.organizationId,
    candidate_id: ctx.candidateId,
    author_id: ctx.userId,
    body: parsed.data.body,
  });
  if (error) return { ...SAVE_FAILED, values };
  return done(ctx.candidateId, "Note added.");
}

export async function deleteNote(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await candidateContext(formData);
  if (!isContext(ctx)) return ctx;
  const noteId = idSchema.safeParse(formString(formData, "rowId"));
  if (!noteId.success) return { status: "error", message: "Unknown note." };

  // RLS allows deleting only your own notes (admins may delete any).
  const { data, error } = await ctx.supabase
    .from("candidate_notes")
    .delete()
    .eq("id", noteId.data)
    .eq("candidate_id", ctx.candidateId)
    .select("id");
  if (error) return SAVE_FAILED;
  if (!data?.length) return { status: "error", message: "You can only delete notes you wrote." };
  return done(ctx.candidateId, "Note deleted.");
}

// --- Resumes ----------------------------------------------------------------

const RESUME_BUCKET = "resumes";

export async function uploadResume(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await candidateContext(formData);
  if (!isContext(ctx)) return ctx;

  const file = formData.get("resume");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", fieldErrors: { resume: "Choose a PDF or Word (.docx) file." } };
  }
  // Reject oversized uploads before reading them into memory.
  if (file.size > MAX_RESUME_BYTES) return { status: "error", fieldErrors: { resume: "Resumes must be 4 MB or smaller." } };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkResumeFile(bytes, file.name);
  if (!check.ok) return { status: "error", fieldErrors: { resume: check.error } };

  const { data: existing } = await ctx.supabase
    .from("candidate_resumes")
    .select("id")
    .eq("candidate_id", ctx.candidateId)
    .eq("sha256", check.sha256)
    .maybeSingle();
  if (existing) return { status: "error", fieldErrors: { resume: "This exact file is already on the candidate's profile." } };

  // The random object name never contains user input; the display name is stored separately.
  const path = `${ctx.organizationId}/${ctx.candidateId}/${crypto.randomUUID()}.${check.extension}`;
  const storage = ctx.supabase.storage.from(RESUME_BUCKET);
  const { error: uploadError } = await storage.upload(path, bytes, { contentType: check.mimeType, upsert: false });
  if (uploadError) {
    console.error("Resume upload failed", uploadError.message);
    return { status: "error", message: "The resume could not be uploaded. Please try again." };
  }

  const { error: insertError } = await ctx.supabase.from("candidate_resumes").insert({
    organization_id: ctx.organizationId,
    candidate_id: ctx.candidateId,
    storage_path: path,
    file_name: check.fileName,
    mime_type: check.mimeType,
    size_bytes: bytes.byteLength,
    sha256: check.sha256,
    uploaded_by: ctx.userId,
  });
  if (insertError) {
    // Don't leave an untracked file behind.
    await storage.remove([path]);
    if (insertError.code === "23505") {
      return { status: "error", fieldErrors: { resume: "This exact file is already on the candidate's profile." } };
    }
    console.error("Resume metadata insert failed", insertError.message);
    return { status: "error", message: "The resume could not be saved. Please try again." };
  }

  return done(ctx.candidateId, `Uploaded ${check.fileName}.`);
}

export async function deleteResume(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await candidateContext(formData);
  if (!isContext(ctx)) return ctx;
  const resumeId = idSchema.safeParse(formString(formData, "rowId"));
  if (!resumeId.success) return { status: "error", message: "Unknown resume." };

  const { data, error } = await ctx.supabase
    .from("candidate_resumes")
    .delete()
    .eq("id", resumeId.data)
    .eq("candidate_id", ctx.candidateId)
    .select("storage_path");
  if (error || !data?.length) return { status: "error", message: "The resume could not be deleted." };

  const { error: storageError } = await ctx.supabase.storage.from(RESUME_BUCKET).remove([data[0].storage_path as string]);
  if (storageError) {
    // The record is gone so the file is no longer reachable from the app; log for cleanup.
    console.error("Resume file removal failed; orphaned object", data[0].storage_path, storageError.message);
  }
  return done(ctx.candidateId, "Resume deleted.");
}
