"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { DuplicateMatch } from "@/lib/candidates/types";
import { candidateFormSchema, idSchema, toCandidateColumns } from "@/lib/candidates/validation";
import { getStaffUser } from "@/lib/auth/session";
import { type FormState, formString } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation/auth";

export type CandidateFormState = FormState & { duplicates?: DuplicateMatch[] };

const FIELDS = ["firstName", "lastName", "email", "phone", "location", "headline", "summary", "source", "ownerId", "tags"] as const;

function readForm(formData: FormData) {
  return Object.fromEntries(FIELDS.map((f) => [f, formString(formData, f)])) as Record<(typeof FIELDS)[number], string>;
}

/** Maps database errors raised by our triggers/constraints to messages; never leaks raw SQL errors. */
function dbErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === "42501" || error.code === "22023") return error.message;
  if (error.code === "23514") return "Some values aren't allowed. Check tags and field lengths.";
  return "The candidate could not be saved. Please try again.";
}

async function findDuplicates(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: { email?: string; phone?: string; firstName: string; lastName: string },
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const { data, error } = await supabase.rpc("find_candidate_duplicates", {
    p_email: input.email ?? null,
    p_phone: input.phone ?? null,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_exclude_id: excludeId ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as DuplicateMatch[];
}

export async function createCandidate(_prev: CandidateFormState, formData: FormData): Promise<CandidateFormState> {
  const user = await getStaffUser();
  if (!user) return { status: "error", message: "Only recruiters and administrators can add candidates." };

  const values = readForm(formData);
  const parsed = candidateFormSchema.safeParse(values);
  if (!parsed.success) {
    return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };
  }

  const supabase = await createClient();
  let newId: string;
  try {
    if (formData.get("confirmDuplicates") !== "on") {
      const duplicates = await findDuplicates(supabase, parsed.data);
      if (duplicates.length) {
        return {
          status: "error",
          message: "This may be someone already in the system. Review the matches below before saving.",
          duplicates,
          values,
        };
      }
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();
    if (profileError || !profile) throw new Error(profileError?.message ?? "Profile not found");

    const columns = toCandidateColumns(parsed.data);
    const { data, error } = await supabase
      .from("candidates")
      .insert({
        ...columns,
        owner_id: columns.owner_id ?? user.id,
        organization_id: profile.organization_id,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (error) return { status: "error", message: dbErrorMessage(error), values };
    newId = data.id as string;
  } catch (error) {
    console.error("Create candidate failed", error instanceof Error ? error.message : error);
    return { status: "error", message: "The candidate could not be saved. Please try again.", values };
  }

  revalidatePath("/recruiter/candidates");
  redirect(`/recruiter/candidates/${newId}?notice=created`);
}

export async function updateCandidate(_prev: CandidateFormState, formData: FormData): Promise<CandidateFormState> {
  const user = await getStaffUser();
  if (!user) return { status: "error", message: "Only recruiters and administrators can edit candidates." };

  const id = idSchema.safeParse(formString(formData, "candidateId"));
  if (!id.success) return { status: "error", message: "Unknown candidate." };

  const values = readForm(formData);
  const parsed = candidateFormSchema.safeParse(values);
  if (!parsed.success) {
    return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };
  }

  const supabase = await createClient();
  try {
    if (formData.get("confirmDuplicates") !== "on") {
      const duplicates = await findDuplicates(supabase, parsed.data, id.data);
      if (duplicates.length) {
        return {
          status: "error",
          message: "These details match other candidates. Review the matches below before saving.",
          duplicates,
          values,
        };
      }
    }

    const { data, error } = await supabase
      .from("candidates")
      .update(toCandidateColumns(parsed.data))
      .eq("id", id.data)
      .select("id");
    if (error) return { status: "error", message: dbErrorMessage(error), values };
    if (!data?.length) return { status: "error", message: "This candidate no longer exists or you can't edit it.", values };
  } catch (error) {
    console.error("Update candidate failed", error instanceof Error ? error.message : error);
    return { status: "error", message: "The candidate could not be saved. Please try again.", values };
  }

  revalidatePath("/recruiter/candidates");
  revalidatePath(`/recruiter/candidates/${id.data}`);
  redirect(`/recruiter/candidates/${id.data}?notice=updated`);
}
