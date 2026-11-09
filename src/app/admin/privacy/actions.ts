"use server";

import { revalidatePath } from "next/cache";

import { isAdmin } from "@/lib/auth/roles";
import { getSessionUser } from "@/lib/auth/session";
import { resolvePrivacySchema } from "@/lib/candidates/portal";
import { type FormState, formString } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation/auth";

/** Administrators move a privacy request along. resolve_privacy_request() re-checks the role. */
export async function resolvePrivacyRequest(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.roles)) return { status: "error", message: "Only administrators can update privacy requests." };

  const parsed = resolvePrivacySchema.safeParse({
    requestId: formString(formData, "requestId"),
    status: formString(formData, "status"),
    note: formString(formData, "note"),
  });
  if (!parsed.success) {
    const fieldErrors = toFieldErrors(parsed.error);
    return { status: "error", message: Object.values(fieldErrors)[0] ?? "Check the form.", fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_privacy_request", {
    p_request_id: parsed.data.requestId,
    p_status: parsed.data.status,
    p_note: parsed.data.note ?? null,
  });
  if (error) {
    if (["22023", "P0002"].includes(error.code ?? "")) return { status: "error", message: error.message };
    console.error("Privacy request update failed", error.code, error.message);
    return { status: "error", message: "The request could not be updated. Please try again." };
  }

  revalidatePath("/admin/privacy");
  return { status: "success", message: "Saved." };
}
