"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isStaff } from "@/lib/auth/roles";
import { getSessionUser } from "@/lib/auth/session";
import { type FormState, formString } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { LEAD_STATUSES } from "@/lib/leads/labels";

const schema = z.object({
  leadId: z.uuid(),
  status: z.enum(LEAD_STATUSES.map((s) => s.value) as [string, ...string[]]),
});

/** Staff-only. RLS (staff policy + column grant on `status`) is the enforcement point. */
export async function updateLeadStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getSessionUser();
  if (!user) return { status: "error", message: "Your session has expired. Sign in again." };
  if (!isStaff(user.roles)) return { status: "error", message: "Only staff can update leads." };

  const parsed = schema.safeParse({ leadId: formString(formData, "leadId"), status: formString(formData, "status") });
  if (!parsed.success) return { status: "error", message: "Choose a valid status." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.leadId)
    .select("id");

  if (error || !data?.length) {
    if (error) console.error("Lead status update failed", error.message);
    return { status: "error", message: "The status could not be updated." };
  }

  revalidatePath("/admin/leads");
  return { status: "success", message: "Status updated." };
}
