"use server";

import { revalidatePath } from "next/cache";

import { ROLE_LABELS } from "@/lib/auth/roles";
import { getSessionUser } from "@/lib/auth/session";
import { type FormState, formString } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { roleChangeSchema } from "@/lib/validation/auth";

/**
 * Assigns or revokes a role. Authorization is enforced by public.assign_role / public.revoke_role
 * in the database (admin-only, never on yourself); the checks here only produce friendlier errors.
 */
export async function changeUserRole(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await getSessionUser();
  if (!actor) return { status: "error", message: "Your session has expired. Sign in again." };
  if (!actor.roles.includes("admin")) return { status: "error", message: "Only administrators can change roles." };

  const intent = formString(formData, "intent");
  if (intent !== "assign" && intent !== "revoke") return { status: "error", message: "Unknown action." };

  const parsed = roleChangeSchema.safeParse({
    userId: formString(formData, "userId"),
    role: formString(formData, "role"),
  });
  if (!parsed.success) return { status: "error", message: "Choose a valid role." };

  const { userId, role } = parsed.data;
  if (userId === actor.id) return { status: "error", message: "You cannot change your own roles." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(intent === "assign" ? "assign_role" : "revoke_role", {
    p_user_id: userId,
    p_role: role,
  });

  if (error) {
    if (error.code === "42501" || error.code === "P0002") return { status: "error", message: error.message };
    console.error("Role change failed", error.code, error.message);
    return { status: "error", message: "The role could not be changed. Please try again." };
  }

  revalidatePath("/admin/users");

  const label = ROLE_LABELS[role];
  if (data === false) {
    return {
      status: "success",
      message: intent === "assign" ? `User already has the ${label} role.` : `User did not have the ${label} role.`,
    };
  }
  return { status: "success", message: intent === "assign" ? `${label} role assigned.` : `${label} role removed.` };
}
