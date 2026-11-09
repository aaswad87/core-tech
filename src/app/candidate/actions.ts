"use server";

import { revalidatePath } from "next/cache";

import { getSessionUser, type SessionUser } from "@/lib/auth/session";
import { myProfileSchema, preferencesSchema, privacyRequestSchema } from "@/lib/candidates/portal";
import { checkResumeFile, MAX_RESUME_BYTES } from "@/lib/candidates/resume-file";
import { idSchema } from "@/lib/candidates/validation";
import { type FormState, formString } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation/auth";

const RESUME_BUCKET = "resumes";
const SAVE_FAILED: FormState = { status: "error", message: "Your changes could not be saved. Please try again." };

/** Candidate accounts only. RLS and the security-definer functions are the real gate; this gives a clear message. */
async function getCandidateUser(): Promise<SessionUser | FormState> {
  const user = await getSessionUser();
  if (!user) return { status: "error", message: "Sign in again to continue." };
  if (!user.roles.includes("candidate")) return { status: "error", message: "This page is for candidate accounts." };
  return user;
}

function isUser(value: SessionUser | FormState): value is SessionUser {
  return "id" in value;
}

/** Messages raised deliberately by our database functions; anything else stays generic. */
function knownDbMessage(error: { code?: string; message: string }): string | null {
  return ["22023", "23505", "42501", "P0002"].includes(error.code ?? "") ? error.message : null;
}

// --- Profile ----------------------------------------------------------------

const PROFILE_FIELDS = ["firstName", "lastName", "phone", "location", "headline", "summary"] as const;

export async function updateMyProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCandidateUser();
  if (!isUser(user)) return user;

  const values = Object.fromEntries(PROFILE_FIELDS.map((f) => [f, formString(formData, f)]));
  const parsed = myProfileSchema.safeParse(values);
  if (!parsed.success) {
    return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_candidate_profile", {
    p_first_name: parsed.data.firstName,
    p_last_name: parsed.data.lastName,
    p_phone: parsed.data.phone ?? null,
    p_location: parsed.data.location ?? null,
    p_headline: parsed.data.headline ?? null,
    p_summary: parsed.data.summary ?? null,
  });
  if (error) {
    if (error.code === "23514") return { status: "error", message: "Some values aren't allowed. Check the field lengths and phone number.", values };
    const known = knownDbMessage(error);
    if (!known) console.error("Profile update failed", error.code, error.message);
    return { ...(known ? { status: "error", message: known } : SAVE_FAILED), values };
  }

  revalidatePath("/candidate", "layout");
  revalidatePath("/account");
  return { status: "success", message: "Your profile has been saved." };
}

// --- Resumes ----------------------------------------------------------------

/** The caller's candidate record, created on first use by the database. */
async function myCandidate(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase.rpc("my_candidate_profile").maybeSingle<{ id: string; organization_id: string }>();
  if (data) return { id: data.id as string, organizationId: data.organization_id as string };

  // No record yet: saving the (current) name creates it, exactly as the profile form would.
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  const full = ((profile?.full_name as string | null) ?? "").trim();
  const [first, ...rest] = full.split(/\s+/);
  const { error } = await supabase.rpc("update_my_candidate_profile", {
    p_first_name: first || "Candidate",
    p_last_name: rest.join(" ") || "-",
    p_phone: null,
    p_location: null,
    p_headline: null,
    p_summary: null,
  });
  if (error) return null;
  const { data: created } = await supabase.rpc("my_candidate_profile").maybeSingle<{ id: string; organization_id: string }>();
  return created ? { id: created.id as string, organizationId: created.organization_id as string } : null;
}

export async function uploadMyResume(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCandidateUser();
  if (!isUser(user)) return user;

  const file = formData.get("resume");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", fieldErrors: { resume: "Choose a PDF or Word (.docx) file." } };
  }
  // Reject oversized uploads before reading them into memory.
  if (file.size > MAX_RESUME_BYTES) return { status: "error", fieldErrors: { resume: "Resumes must be 4 MB or smaller." } };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkResumeFile(bytes, file.name);
  if (!check.ok) return { status: "error", fieldErrors: { resume: check.error } };

  const supabase = await createClient();
  const candidate = await myCandidate(supabase, user.id);
  if (!candidate) return SAVE_FAILED;

  const { data: existing } = await supabase
    .from("candidate_resumes")
    .select("id")
    .eq("candidate_id", candidate.id)
    .eq("sha256", check.sha256)
    .maybeSingle();
  if (existing) return { status: "error", fieldErrors: { resume: "This exact file is already on your profile." } };

  const { count } = await supabase
    .from("candidate_resumes")
    .select("id", { count: "exact", head: true })
    .eq("candidate_id", candidate.id)
    .eq("uploaded_by", user.id);
  if ((count ?? 0) >= 5) {
    return { status: "error", fieldErrors: { resume: "You can keep up to 5 resumes. Remove one before uploading another." } };
  }

  // The random object name never contains user input; the display name is stored separately.
  const path = `${candidate.organizationId}/${candidate.id}/${crypto.randomUUID()}.${check.extension}`;
  const storage = supabase.storage.from(RESUME_BUCKET);
  const { error: uploadError } = await storage.upload(path, bytes, { contentType: check.mimeType, upsert: false });
  if (uploadError) {
    console.error("Candidate resume upload failed", uploadError.message);
    return { status: "error", message: "Your resume could not be uploaded. Please try again." };
  }

  const { error: insertError } = await supabase.from("candidate_resumes").insert({
    organization_id: candidate.organizationId,
    candidate_id: candidate.id,
    storage_path: path,
    file_name: check.fileName,
    mime_type: check.mimeType,
    size_bytes: bytes.byteLength,
    sha256: check.sha256,
    uploaded_by: user.id,
  });
  if (insertError) {
    // Don't leave an untracked file behind.
    await storage.remove([path]);
    if (insertError.code === "23505") return { status: "error", fieldErrors: { resume: "This exact file is already on your profile." } };
    console.error("Candidate resume metadata insert failed", insertError.code, insertError.message);
    return { status: "error", message: "Your resume could not be saved. Please try again." };
  }

  revalidatePath("/candidate", "layout");
  return { status: "success", message: `Uploaded ${check.fileName}.` };
}

export async function deleteMyResume(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCandidateUser();
  if (!isUser(user)) return user;
  const resumeId = idSchema.safeParse(formString(formData, "resumeId"));
  if (!resumeId.success) return { status: "error", message: "Unknown resume." };

  const supabase = await createClient();
  // RLS limits this to resumes the candidate uploaded on their own record.
  const { data, error } = await supabase
    .from("candidate_resumes")
    .delete()
    .eq("id", resumeId.data)
    .eq("uploaded_by", user.id)
    .select("storage_path");
  if (error || !data?.length) return { status: "error", message: "This resume could not be removed." };

  const { error: storageError } = await supabase.storage.from(RESUME_BUCKET).remove([data[0].storage_path as string]);
  if (storageError) console.error("Candidate resume file removal failed", storageError.message);

  revalidatePath("/candidate", "layout");
  return { status: "success", message: "Resume removed." };
}

// --- Preferences ------------------------------------------------------------

export async function savePreferences(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCandidateUser();
  if (!isUser(user)) return user;

  const parsed = preferencesSchema.safeParse({
    openToOpportunities: formString(formData, "openToOpportunities"),
    desiredTitles: formString(formData, "desiredTitles"),
    preferredLocations: formString(formData, "preferredLocations"),
    workArrangement: formString(formData, "workArrangement"),
    willingToRelocate: formString(formData, "willingToRelocate"),
    emailJobAlerts: formString(formData, "emailJobAlerts"),
    emailApplicationUpdates: formString(formData, "emailApplicationUpdates"),
    phoneContactOk: formString(formData, "phoneContactOk"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const p = parsed.data;
  const { error } = await supabase.rpc("set_my_preferences", {
    p_open_to_opportunities: p.openToOpportunities,
    p_desired_titles: p.desiredTitles ?? null,
    p_preferred_locations: p.preferredLocations ?? null,
    p_work_arrangement: p.workArrangement ?? null,
    p_willing_to_relocate: p.willingToRelocate,
    p_email_job_alerts: p.emailJobAlerts,
    p_email_application_updates: p.emailApplicationUpdates,
    p_phone_contact_ok: p.phoneContactOk,
  });
  if (error) {
    const known = knownDbMessage(error);
    if (!known) console.error("Preferences update failed", error.code, error.message);
    return known ? { status: "error", message: known } : SAVE_FAILED;
  }

  revalidatePath("/candidate", "layout");
  return { status: "success", message: "Your preferences have been saved." };
}

// --- Privacy requests -------------------------------------------------------

export async function submitPrivacyRequest(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getSessionUser();
  if (!user) return { status: "error", message: "Sign in again to continue." };

  const values = { kind: formString(formData, "kind"), details: formString(formData, "details") };
  const parsed = privacyRequestSchema.safeParse(values);
  if (!parsed.success) {
    return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_privacy_request", { p_kind: parsed.data.kind, p_details: parsed.data.details ?? null });
  if (error) {
    const known = knownDbMessage(error);
    if (!known) console.error("Privacy request failed", error.code, error.message);
    return { status: "error", message: known ?? "Your request could not be sent. Please try again.", values };
  }

  revalidatePath("/candidate/privacy");
  revalidatePath("/admin/privacy");
  return { status: "success", message: "Request received. An administrator will review it and reply by email." };
}
