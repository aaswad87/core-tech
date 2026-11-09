"use server";

import { headers } from "next/headers";

import { getSupabaseSecretKey, isLeadCaptureConfigured } from "@/lib/env.server";
import type { FormState } from "@/lib/forms";
import { clientIpFromHeaders, hashIp, isRateLimited, LEAD_RATE_LIMITS, windowStart } from "@/lib/leads/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { toFieldErrors } from "@/lib/validation/auth";
import { leadSchema, toLeadRow } from "@/lib/validation/leads";

const ECHO_FIELDS = [
  "fullName", "email", "phone", "topic", "companyName", "contactTitle", "roleTitle",
  "location", "positionsCount", "timeline", "specialty", "message",
] as const;

const SUCCESS_MESSAGES = {
  contact: "Thank you — your message has been received. A member of our team will reply by email.",
  employer: "Thank you — your hiring request has been received. A recruiter will contact you to discuss the role.",
  candidate: "Thank you — your details have been received. A recruiter will reach out if there's a good match.",
} as const;

const FAILED: FormState = {
  status: "error",
  message: "Your message could not be sent. Please try again in a few minutes.",
};

function echo(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of ECHO_FIELDS) {
    const value = formData.get(key);
    if (typeof value === "string") values[key] = value.slice(0, 5000);
  }
  return values;
}

/**
 * Persists a public lead form. Runs entirely on the server: validates input, rejects honeypot hits,
 * rate-limits by hashed IP and email, then inserts with the service-role client (the leads table
 * has no client-side insert path).
 */
export async function submitLead(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = echo(formData);

  if (!isLeadCaptureConfigured()) {
    return { status: "error", message: "This form isn't accepting submissions yet. Please try again later.", values };
  }

  const raw = Object.fromEntries(
    [...formData.entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const parsed = leadSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors = toFieldErrors(parsed.error);
    // A filled honeypot or tampered hidden field gets a generic failure, not field hints.
    if (fieldErrors.website || fieldErrors.type || fieldErrors.sourcePath) return { ...FAILED, values };
    return { status: "error", message: "Please correct the highlighted fields.", fieldErrors, values };
  }

  const input = parsed.data;
  const secret = getSupabaseSecretKey()!;
  const ip = clientIpFromHeaders(await headers());
  const ipHash = ip ? hashIp(ip, secret) : null;

  try {
    const supabase = createAdminClient();

    const [ipCount, emailCount] = await Promise.all([
      ipHash
        ? supabase
            .from("leads")
            .select("id", { count: "exact", head: true })
            .eq("ip_hash", ipHash)
            .gte("created_at", windowStart(LEAD_RATE_LIMITS.perIp.windowMinutes))
        : Promise.resolve(null),
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        // Emails are lowercased by the schema before storage, so an exact match is case-insensitive.
        .eq("email", input.email)
        .gte("created_at", windowStart(LEAD_RATE_LIMITS.perEmail.windowMinutes)),
    ]);

    if (ipCount?.error || emailCount.error) throw ipCount?.error ?? emailCount.error;
    if (isRateLimited({ ip: ipCount ? (ipCount.count ?? 0) : null, email: emailCount.count ?? 0 })) {
      return {
        status: "error",
        message: "We've received several messages from you recently. Please wait a little while before sending another.",
        values,
      };
    }

    const row = toLeadRow(input);

    // Only reference jobs that are currently public.
    if (row.job_id) {
      const { data: job } = await supabase.rpc("get_published_job", { p_job_id: row.job_id });
      if (!Array.isArray(job) || job.length === 0) row.job_id = null;
    }

    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("id")
      .eq("is_default", true)
      .single();
    if (orgError || !org) throw orgError ?? new Error("Default organization missing");

    const { error: insertError } = await supabase.from("leads").insert({
      ...row,
      organization_id: org.id,
      consent_at: new Date().toISOString(),
      ip_hash: ipHash,
    });
    if (insertError) throw insertError;
  } catch (error) {
    console.error("Lead submission failed", error instanceof Error ? error.message : error);
    return { ...FAILED, values };
  }

  return { status: "success", message: SUCCESS_MESSAGES[input.type] };
}
